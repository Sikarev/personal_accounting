package httpapi

import (
	"archive/zip"
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"personal-accounting/api/internal/db/dbgen"
	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/problem"
)

// Экспорт в CSV (docs/api.md → «Экспорт»). Файл не собирается в памяти:
// операции читаются пачками по курсору ленты и сразу пишутся в ответ. Все
// чтения одной выгрузки — в одной транзакции REPEATABLE READ, поэтому файл —
// согласованный срез: операция, добавленная во время выгрузки, не попадёт
// в него наполовину (а в полном экспорте остатки счетов сходятся с операциями).

// exportBatchSize — сколько операций читается из БД за раз. В памяти
// одновременно только одна пачка.
const exportBatchSize = 1000

// Названия видов операций, типов счетов и видов категорий — как в интерфейсе
// (web/src/shared/i18n/ru.ts).
var (
	exportKindNames = map[dbgen.TransactionKind]string{
		dbgen.TransactionKindExpense:    "Расход",
		dbgen.TransactionKindIncome:     "Доход",
		dbgen.TransactionKindTransfer:   "Перевод",
		dbgen.TransactionKindAdjustment: "Корректировка",
	}
	exportAccountTypeNames = map[dbgen.AccountType]string{
		dbgen.AccountTypeCash:        "Наличные",
		dbgen.AccountTypeCard:        "Карта",
		dbgen.AccountTypeBankAccount: "Банковский счёт",
		dbgen.AccountTypeDeposit:     "Вклад",
		dbgen.AccountTypeCreditCard:  "Кредитная карта",
		dbgen.AccountTypeOther:       "Другое",
	}
	exportCategoryKindNames = map[dbgen.CategoryKind]string{
		dbgen.CategoryKindExpense: "Расход",
		dbgen.CategoryKindIncome:  "Доход",
	}
)

// Колонки файлов. Индексы колонок операций — константы ниже: запись строки
// заполняет ячейки по ним, а не по порядку append.
var (
	exportTxHeader = []string{
		"Дата", "Вид", "Счёт", "Сумма", "Валюта",
		"Счёт зачисления", "Сумма зачисления", "Валюта зачисления",
		"Личный счёт участника", "Категория", "Подкатегория",
		"Комментарий", "Автор", "Создана",
	}
	exportAccountsHeader = []string{
		"Название", "Тип", "Валюта", "Видимость",
		"Начальный остаток", "Текущий остаток", "В общем балансе", "В архиве",
	}
	exportCategoriesHeader = []string{"Вид", "Категория", "Подкатегория", "В архиве"}
)

const (
	colDate = iota
	colKind
	colAccount
	colAmount
	colCurrency
	colToAccount
	colToAmount
	colToCurrency
	colCounterparty
	colCategory
	colSubcategory
	colComment
	colAuthor
	colCreatedAt
	colCount
)

// ---------------------------------------------------------------------------
// Ответ потоком
// ---------------------------------------------------------------------------

// streamResponse — ответ-файл, который пишется прямо в соединение.
// Сгенерированные типы ответов (ExportTransactions200TextcsvResponse и т. п.)
// принимают io.Reader: ошибку посреди выгрузки они вернули бы strict-серверу,
// и тот дописал бы Problem JSON в середину CSV. Поэтому свой тип: он
// реализует интерфейсы ответов обеих операций (метод Visit…Response).
type streamResponse struct {
	contentType string
	// writeTimeout — дедлайн на каждую запись в соединение (см. deadlineWriter).
	writeTimeout time.Duration
	// open готовит выгрузку до отправки заголовков: открывает транзакцию,
	// читает справочники и первую пачку. Ошибка здесь — обычный Problem JSON.
	// Возвращает имя файла, функцию записи тела и функцию освобождения ресурсов.
	open func() (filename string, write func(io.Writer) error, release func(), err error)
}

// errStreamAborted — ошибка после начала ответа: статус 200 и часть файла уже
// ушли клиенту, Problem JSON отправить нельзя. responseErrorHandler пишет её
// в лог и обрывает соединение — так клиент увидит сбой загрузки, а не
// обрезанный файл, похожий на целый.
type errStreamAborted struct{ err error }

func (e *errStreamAborted) Error() string { return "stream aborted: " + e.err.Error() }
func (e *errStreamAborted) Unwrap() error { return e.err }

func (r streamResponse) visit(w http.ResponseWriter) error {
	filename, write, release, err := r.open()
	if err != nil {
		return err
	}
	defer release()

	h := w.Header()
	h.Set("Content-Type", r.contentType)
	// Имя — латиницей и цифрами, поэтому кавычек и filename* не нужно.
	h.Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	// Личные данные не должны оседать в кэшах браузера и прокси.
	h.Set("Cache-Control", "no-store")
	h.Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)

	dw := &deadlineWriter{w: w, rc: http.NewResponseController(w), timeout: r.writeTimeout}
	// Буфер побольше, чтобы не отправлять ответ мелкими кусками.
	bw := bufio.NewWriterSize(dw, 32<<10)
	if err := write(bw); err != nil {
		return &errStreamAborted{err}
	}
	if err := bw.Flush(); err != nil {
		return &errStreamAborted{err}
	}
	// Снимаем дедлайн: соединение keep-alive обслужит следующий запрос, а у
	// http.Server нет WriteTimeout, который сбросил бы его сам.
	dw.clear()
	return nil
}

// deadlineWriter продлевает дедлайн записи в соединение перед каждой записью.
// Выгрузка держит транзакцию и соединение пула, пока пишет файл, а у
// http.Server нет WriteTimeout: клиент, который перестал читать, держал бы их
// вечно. С дедлайном запись, не продвинувшаяся за timeout, падает, выгрузка
// обрывается и всё освобождается. Медленный, но живой клиент не страдает:
// дедлайн отсчитывается заново на каждом куске (до 32 КБ), то есть нужно
// принимать хотя бы 32 КБ за timeout.
type deadlineWriter struct {
	w       io.Writer
	rc      *http.ResponseController
	timeout time.Duration
	// unsupported — ResponseWriter не умеет дедлайны (httptest.ResponseRecorder
	// в тестах); тогда пишем без них.
	unsupported bool
}

func (d *deadlineWriter) Write(p []byte) (int, error) {
	if d.timeout > 0 && !d.unsupported {
		// time.Now, а не s.now: дедлайн сокета — по настоящим часам.
		if err := d.rc.SetWriteDeadline(time.Now().Add(d.timeout)); err != nil {
			if !errors.Is(err, http.ErrNotSupported) {
				return 0, err
			}
			d.unsupported = true
		}
	}
	return d.w.Write(p)
}

func (d *deadlineWriter) clear() {
	if d.timeout > 0 && !d.unsupported {
		_ = d.rc.SetWriteDeadline(time.Time{})
	}
}

// exportBusyRetryAfter — Retry-After, когда все слоты выгрузки заняты или у
// пользователя уже идёт выгрузка: выгрузка длится секунды.
const exportBusyRetryAfter = 5 * time.Second

// exportGate ограничивает одновременные выгрузки: всего — slots (заметно
// меньше пула соединений БД, чтобы выгрузки не заняли его целиком и
// остальные запросы не ждали), и не больше одной на пользователя. Не ждёт:
// занято — сразу отказ (429), иначе медленные клиенты копили бы очередь.
type exportGate struct {
	slots chan struct{} // буферизованный канал как семафор: занятое место — слот
	mu    sync.Mutex
	users map[uuid.UUID]struct{}
}

func newExportGate(slots int) *exportGate {
	return &exportGate{slots: make(chan struct{}, max(slots, 1)), users: map[uuid.UUID]struct{}{}}
}

// acquire занимает слот для пользователя; free освобождает его (один раз).
func (g *exportGate) acquire(user uuid.UUID) (free func(), ok bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, busy := g.users[user]; busy {
		return nil, false
	}
	select {
	case g.slots <- struct{}{}: // место есть
	default:
		return nil, false
	}
	g.users[user] = struct{}{}
	var once sync.Once
	return func() {
		once.Do(func() {
			g.mu.Lock()
			delete(g.users, user)
			g.mu.Unlock()
			<-g.slots
		})
	}, true
}

// headExport — ответ экспорта на HEAD. middleware.GetHead обслуживает HEAD
// обработчиком GET, и без этого HEAD выполнял бы всю выгрузку (тело потом
// выбрасывается), занимал слот и тратил лимит полного экспорта. Отвечаем
// заголовками без работы: типом файла, без имени (для него нужна БД).
type headExport struct{ contentType string }

func (h headExport) visit(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", h.contentType)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	return nil
}

func (h headExport) VisitExportTransactionsResponse(w http.ResponseWriter) error { return h.visit(w) }
func (h headExport) VisitExportAllResponse(w http.ResponseWriter) error          { return h.visit(w) }

// exportHeadMiddleware — strict-middleware: на HEAD к экспорту отвечает
// headExport, не вызывая обработчик. Метод запроса есть только здесь —
// обработчик strict-сервера получает лишь разобранные параметры.
// operationID здесь — имя метода Go (ExportAll), а не operationId контракта.
func exportHeadMiddleware(f oapi.StrictHandlerFunc, operationID string) oapi.StrictHandlerFunc {
	contentType, ok := map[string]string{
		"ExportTransactions": "text/csv; charset=utf-8",
		"ExportAll":          "application/zip",
	}[operationID]
	if !ok {
		return f
	}
	return func(ctx context.Context, w http.ResponseWriter, r *http.Request, req any) (any, error) {
		if r.Method == http.MethodHead {
			return headExport{contentType: contentType}, nil
		}
		return f(ctx, w, r, req)
	}
}

func (r streamResponse) VisitExportTransactionsResponse(w http.ResponseWriter) error {
	return r.visit(w)
}

func (r streamResponse) VisitExportAllResponse(w http.ResponseWriter) error {
	return r.visit(w)
}

// ---------------------------------------------------------------------------
// Данные выгрузки
// ---------------------------------------------------------------------------

// exporter — открытая транзакция выгрузки и справочники, нужные для строк
// операций. Справочники маленькие (счета и категории семьи), их держим
// в памяти целиком.
type exporter struct {
	tx         pgx.Tx
	q          *dbgen.Queries
	p          Principal
	loc        *time.Location
	today      time.Time
	minorUnits map[string]int
	// accounts — видимые счета (включая архивные) с остатками; их же
	// названия — в accountNames.
	accounts     []dbgen.ListAccountsRow
	accountNames map[uuid.UUID]string
	// categories — все категории семьи в порядке ListCategories.
	categories []dbgen.Category
	categoryBy map[uuid.UUID]dbgen.Category
}

// openExporter открывает транзакцию только для чтения (REPEATABLE READ — один
// снимок на всю выгрузку) и читает справочники. Закрывает её close.
func (s *server) openExporter(ctx context.Context, p Principal) (*exporter, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	e := &exporter{tx: tx, q: s.q.WithTx(tx), p: p}
	if err := e.load(ctx, s.now()); err != nil {
		e.close(ctx)
		return nil, err
	}
	return e, nil
}

func (e *exporter) load(ctx context.Context, now time.Time) error {
	tz, err := e.q.GetUserTimezone(ctx, e.p.UserID)
	if err != nil {
		return fmt.Errorf("get user timezone: %w", err)
	}
	if e.loc, err = time.LoadLocation(tz); err != nil {
		return fmt.Errorf("load user timezone %q: %w", tz, err)
	}
	e.today = dateIn(now, e.loc)

	currencies, err := e.q.ListCurrencyMinorUnits(ctx)
	if err != nil {
		return fmt.Errorf("list currencies: %w", err)
	}
	e.minorUnits = make(map[string]int, len(currencies))
	for _, c := range currencies {
		e.minorUnits[c.Code] = int(c.MinorUnits)
	}

	// today нужен ListAccounts для baseBalance; в выгрузку он не идёт.
	e.accounts, err = e.q.ListAccounts(ctx, dbgen.ListAccountsParams{
		FamilyID: e.p.FamilyID, UserID: e.p.UserID, Today: e.today,
	})
	if err != nil {
		return fmt.Errorf("list accounts: %w", err)
	}
	e.accountNames = make(map[uuid.UUID]string, len(e.accounts))
	for _, a := range e.accounts {
		e.accountNames[a.ID] = a.Name
	}

	e.categories, err = e.q.ListCategories(ctx, e.p.FamilyID)
	if err != nil {
		return fmt.Errorf("list categories: %w", err)
	}
	e.categoryBy = make(map[uuid.UUID]dbgen.Category, len(e.categories))
	for _, c := range e.categories {
		e.categoryBy[c.ID] = c
	}
	return nil
}

// close завершает транзакцию. Она только читала, поэтому Rollback ничем не
// отличается от Commit. Контекст — фоновый: выгрузка могла оборваться из-за
// отмены запроса, а соединение всё равно нужно вернуть в пул чистым.
func (e *exporter) close(ctx context.Context) {
	_ = e.tx.Rollback(context.WithoutCancel(ctx))
}

// money — сумма в основных единицах валюты cur.
func (e *exporter) money(v int64, cur string) string {
	mu, ok := e.minorUnits[cur]
	if !ok {
		mu = 2 // не бывает: валюта счёта ссылается на справочник
	}
	return formatMinor(v, mu)
}

// txBatches читает операции пачками по курсору ленты (дата ↓, id ↓) с теми
// же фильтрами и правилами видимости, что у GET /transactions: тот же запрос
// ListTransactions, поэтому выборка совпадает с лентой по построению.
type txBatches struct {
	e          *exporter
	f          txFilters
	cursorDate *time.Time
	cursorID   *uuid.UUID
	done       bool
}

// next — следующая пачка; пустая — операции кончились.
func (b *txBatches) next(ctx context.Context) ([]dbgen.ListTransactionsRow, error) {
	if b.done {
		return nil, nil
	}
	e, f := b.e, b.f
	rows, err := e.q.ListTransactions(ctx, dbgen.ListTransactionsParams{
		FamilyID: e.p.FamilyID, UserID: e.p.UserID,
		DateFrom: f.from, DateTo: f.to, Kinds: f.kinds, AccountIds: f.accounts,
		CategoryIds: f.categories, AuthorIds: f.authors, Search: f.search,
		CursorDate: b.cursorDate, CursorID: b.cursorID, RowLimit: exportBatchSize,
	})
	if err != nil {
		return nil, fmt.Errorf("export transactions: %w", err)
	}
	if len(rows) < exportBatchSize {
		b.done = true
	} else {
		last := rows[len(rows)-1]
		b.cursorDate, b.cursorID = &last.OpDate, &last.ID
	}
	return rows, nil
}

// writeTransactions пишет CSV операций: первую пачку (её прочитали до
// отправки заголовков, чтобы ошибка запроса стала Problem JSON), затем
// остальные.
func (e *exporter) writeTransactions(ctx context.Context, w io.Writer, b *txBatches, first []dbgen.ListTransactionsRow) error {
	cw, err := newCSVWriter(w)
	if err != nil {
		return err
	}
	if err := cw.Write(exportTxHeader); err != nil {
		return err
	}
	rows := first
	for len(rows) > 0 {
		for _, r := range rows {
			if err := cw.Write(e.transactionRecord(txRow(r))); err != nil {
				return err
			}
		}
		// Flush после пачки: данные уходят клиенту по мере чтения, а не в конце.
		cw.Flush()
		if err := cw.Error(); err != nil {
			return err
		}
		if rows, err = b.next(ctx); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// transactionRecord — строка операции. Знаки: расход — с минусом, доход —
// без, корректировка — со своим знаком (это изменение остатка), у перевода
// обе суммы положительные — направление задают колонки счетов. Так сумма
// колонки «Сумма» по расходам и доходам — чистый итог периода.
//
// Видимость — как в ленте (transactionToAPI): сторона перевода на чужом
// личном счёте остаётся пустой (счёт, сумма, валюта), а в колонке «Личный
// счёт участника» — имя владельца этого счёта.
func (e *exporter) transactionRecord(r txRow) []string {
	rec := make([]string, colCount)
	uid := e.p.UserID
	rec[colDate] = formatExportDate(r.OpDate)
	rec[colKind] = exportKindNames[r.Kind]

	var counterparty *string
	if accountVisible(r.AccountOwnerID, uid) {
		amount := r.Amount // в БД знак — изменение остатка: расход < 0, доход > 0
		if r.Kind == dbgen.TransactionKindTransfer {
			amount = abs(amount)
		}
		rec[colAccount] = csvText(e.accountNames[r.AccountID])
		rec[colAmount] = e.money(amount, r.Currency)
		rec[colCurrency] = r.Currency
	} else {
		counterparty = r.AccountOwnerName
	}
	if r.ToAccountID != nil {
		if accountVisible(r.ToAccountOwnerID, uid) {
			if r.ToAmount != nil && r.ToCurrency != nil {
				rec[colToAccount] = csvText(e.accountNames[*r.ToAccountID])
				rec[colToAmount] = e.money(*r.ToAmount, *r.ToCurrency)
				rec[colToCurrency] = *r.ToCurrency
			}
		} else {
			counterparty = r.ToAccountOwnerName
		}
	}
	if counterparty != nil {
		rec[colCounterparty] = csvText(*counterparty)
	}

	if r.CategoryID != nil {
		if c, ok := e.categoryBy[*r.CategoryID]; ok {
			if parent, ok := e.parentOf(c); ok {
				rec[colCategory], rec[colSubcategory] = csvText(parent.Name), csvText(c.Name)
			} else {
				rec[colCategory] = csvText(c.Name)
			}
		}
	}
	rec[colComment] = csvText(r.Comment)
	if r.AuthorName != nil {
		rec[colAuthor] = csvText(*r.AuthorName)
	}
	rec[colCreatedAt] = formatExportDateTime(r.CreatedAt, e.loc)
	return rec
}

func (e *exporter) parentOf(c dbgen.Category) (dbgen.Category, bool) {
	if c.ParentID == nil {
		return dbgen.Category{}, false
	}
	p, ok := e.categoryBy[*c.ParentID]
	return p, ok
}

// writeAccounts — accounts.csv: видимые пользователю счета, включая архивные.
// Чужие личные счета в список не попадают (ListAccounts фильтрует видимость).
func (e *exporter) writeAccounts(w io.Writer) error {
	cw, err := newCSVWriter(w)
	if err != nil {
		return err
	}
	if err := cw.Write(exportAccountsHeader); err != nil {
		return err
	}
	for _, a := range e.accounts {
		visibility := "Общий"
		if a.OwnerUserID != nil {
			visibility = "Личный"
		}
		if err := cw.Write([]string{
			csvText(a.Name),
			exportAccountTypeNames[a.Type],
			a.CurrencyCode,
			visibility,
			e.money(a.InitialBalance, a.CurrencyCode),
			e.money(a.Balance, a.CurrencyCode),
			yesNo(a.IncludeInTotal),
			yesNo(a.ArchivedAt != nil),
		}); err != nil {
			return err
		}
	}
	cw.Flush()
	return cw.Error()
}

// writeCategories — categories.csv: оба дерева, включая архивные. Порядок —
// как в интерфейсе: расходы, затем доходы; за категорией верхнего уровня —
// её подкатегории. У подкатегории в колонке «Категория» — родитель, поэтому
// строку можно понять без остальных (фильтр в Excel).
func (e *exporter) writeCategories(w io.Writer) error {
	cw, err := newCSVWriter(w)
	if err != nil {
		return err
	}
	if err := cw.Write(exportCategoriesHeader); err != nil {
		return err
	}
	// ListCategories уже упорядочен по виду и sort_order, поэтому дети одного
	// родителя в children идут в своём порядке.
	children := map[uuid.UUID][]dbgen.Category{}
	for _, c := range e.categories {
		if c.ParentID != nil {
			children[*c.ParentID] = append(children[*c.ParentID], c)
		}
	}
	for _, c := range e.categories {
		if c.ParentID != nil {
			continue
		}
		kind := exportCategoryKindNames[c.Kind]
		if err := cw.Write([]string{kind, csvText(c.Name), "", yesNo(c.ArchivedAt != nil)}); err != nil {
			return err
		}
		for _, ch := range children[c.ID] {
			if err := cw.Write([]string{kind, csvText(c.Name), csvText(ch.Name), yesNo(ch.ArchivedAt != nil)}); err != nil {
				return err
			}
		}
	}
	cw.Flush()
	return cw.Error()
}

// ---------------------------------------------------------------------------
// Обработчики
// ---------------------------------------------------------------------------

// startExport занимает слот выгрузки, открывает транзакцию и читает первую
// пачку операций — всё, что может сломаться до отправки заголовков. release
// закрывает транзакцию и освобождает слот; при ошибке всё освобождено.
func (s *server) startExport(ctx context.Context, p Principal, f txFilters) (e *exporter, b *txBatches, first []dbgen.ListTransactionsRow, release func(), err error) {
	free, ok := s.exportGate.acquire(p.UserID)
	if !ok {
		return nil, nil, nil, nil, problem.TooManyRequests(exportBusyRetryAfter)
	}
	e, err = s.openExporter(ctx, p)
	if err != nil {
		free()
		return nil, nil, nil, nil, err
	}
	release = func() {
		e.close(ctx)
		free()
	}
	b = &txBatches{e: e, f: f}
	if first, err = b.next(ctx); err != nil {
		release()
		return nil, nil, nil, nil, err
	}
	return e, b, first, release, nil
}

func (s *server) ExportTransactions(ctx context.Context, req oapi.ExportTransactionsRequestObject) (oapi.ExportTransactionsResponseObject, error) {
	p := currentUser(ctx)
	prm := req.Params
	f := newTxFilters(prm.From, prm.To, prm.Kind, prm.AccountId, prm.CategoryId, prm.AuthorId, prm.Q)
	return streamResponse{
		contentType:  "text/csv; charset=utf-8",
		writeTimeout: s.exportWriteTimeout,
		open: func() (string, func(io.Writer) error, func(), error) {
			e, b, first, release, err := s.startExport(ctx, p, f)
			if err != nil {
				return "", nil, nil, err
			}
			write := func(w io.Writer) error { return e.writeTransactions(ctx, w, b, first) }
			return "operations-" + e.today.Format(time.DateOnly) + ".csv", write, release, nil
		},
	}, nil
}

func (s *server) ExportAll(ctx context.Context, _ oapi.ExportAllRequestObject) (oapi.ExportAllResponseObject, error) {
	p := currentUser(ctx)
	key := p.UserID.String()
	// Здесь только проверка: попытка списывается после успешного открытия
	// выгрузки — сбой БД или занятый слот лимит не тратят. Check и Add не
	// атомарны вместе, но две выгрузки одного пользователя одновременно не
	// идут (exportGate), так что лимит не проскочить параллельными запросами.
	if retry, ok := s.exportAllPerUser.Check(key); !ok {
		return nil, problem.TooManyRequests(retry)
	}
	return streamResponse{
		contentType:  "application/zip",
		writeTimeout: s.exportWriteTimeout,
		open: func() (string, func(io.Writer) error, func(), error) {
			e, b, first, release, err := s.startExport(ctx, p, txFilters{})
			if err != nil {
				return "", nil, nil, err
			}
			s.exportAllPerUser.Add(key)
			now := s.now()
			write := func(w io.Writer) error {
				zw := zip.NewWriter(w)
				files := []struct {
					name  string
					write func(io.Writer) error
				}{
					{"accounts.csv", e.writeAccounts},
					{"categories.csv", e.writeCategories},
					{"transactions.csv", func(w io.Writer) error { return e.writeTransactions(ctx, w, b, first) }},
				}
				for _, f := range files {
					fw, err := zw.CreateHeader(&zip.FileHeader{Name: f.name, Method: zip.Deflate, Modified: now.In(e.loc)})
					if err != nil {
						return err
					}
					if err := f.write(fw); err != nil {
						return fmt.Errorf("%s: %w", f.name, err)
					}
				}
				return zw.Close()
			}
			return "export-" + e.today.Format(time.DateOnly) + ".zip", write, release, nil
		},
	}, nil
}

// Проверка на этапе компиляции: streamResponse подходит как ответ обеих операций.
var (
	_ oapi.ExportTransactionsResponseObject = streamResponse{}
	_ oapi.ExportAllResponseObject          = streamResponse{}
	_ oapi.ExportTransactionsResponseObject = headExport{}
	_ oapi.ExportAllResponseObject          = headExport{}
)
