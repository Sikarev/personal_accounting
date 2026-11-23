package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"personal-accounting/api/internal/db/dbgen"
	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/problem"
)

const (
	// feedDefaultLimit и feedMaxLimit — размер страницы ленты; максимум
	// проверяет и контракт.
	feedDefaultLimit = 50
	feedMaxLimit     = 200
	// frequentCategoriesLimit — сколько частых категорий каждого вида отдаёт defaults.
	frequentCategoriesLimit = 8
	// frequentCategoriesDays — окно «частых» категорий в днях, включая сегодня.
	frequentCategoriesDays = 90
)

// Внешние ключи transactions (00001_init.sql): по имени нарушенного
// ограничения понятно, какое поле запроса виновато.
const (
	fkTransactionAccount   = "transactions_family_id_account_id_fkey"
	fkTransactionToAccount = "transactions_family_id_to_account_id_fkey"
	fkTransactionCategory  = "transactions_family_id_category_id_fkey"
)

// txRow — строка операции с данными счетов и авторов. ListTransactionsRow
// и GetTransactionRow — одинаковые структуры (запросы выбирают одни и те же
// колонки), поэтому строку ленты можно привести к txRow: txRow(r).
type txRow = dbgen.GetTransactionRow

func errTransactionNotFound() *problem.Problem {
	return problem.NotFound("Операция не найдена.")
}

func errTransactionReadonly() *problem.Problem {
	return problem.Forbidden(problem.CodeTransactionReadonly,
		"Операцию может изменить только владелец личного счёта.")
}

// ---------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------

// txFilters — фильтры ленты и итогов в виде параметров SQL.
type txFilters struct {
	from, to   *time.Time
	kinds      []string
	accounts   []uuid.UUID
	categories []uuid.UUID
	authors    []uuid.UUID
	search     string
}

// newTxFilters собирает фильтры из параметров запроса. У ленты и итогов
// параметры одинаковые, но типы параметров у операций разные — поэтому
// функция принимает поля по отдельности.
func newTxFilters(from, to *openapi_types.Date, kinds *[]oapi.TransactionKind,
	accounts, categories, authors *[]openapi_types.UUID, q *string,
) txFilters {
	f := txFilters{}
	if from != nil {
		f.from = &from.Time
	}
	if to != nil {
		f.to = &to.Time
	}
	if kinds != nil {
		for _, k := range *kinds {
			f.kinds = append(f.kinds, string(k))
		}
	}
	if accounts != nil {
		f.accounts = *accounts
	}
	if categories != nil {
		f.categories = *categories
	}
	if authors != nil {
		f.authors = *authors
	}
	if q != nil {
		f.search = searchPattern(*q)
	}
	return f
}

// likeEscaper экранирует спецсимволы LIKE: иначе «100%» в поиске значило бы
// «100 и что угодно». Обратная косая черта — символ экранирования LIKE по
// умолчанию, поэтому она экранируется первой (Replacer заменяет за один проход).
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// searchPattern готовит строку поиска так же, как SQL готовит комментарий:
// нижний регистр и «ё» → «е». Пробелы по краям не значимы; пустая строка —
// без фильтра.
func searchPattern(q string) string {
	q = strings.ReplaceAll(strings.ToLower(strings.TrimSpace(q)), "ё", "е")
	return likeEscaper.Replace(q)
}

// Курсор ленты — дата и id последней операции страницы. Клиент передаёт его
// как есть; base64 — чтобы строка не выглядела как что-то, что можно собрать
// руками, и не требовала экранирования в адресе.
func encodeCursor(date time.Time, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte(date.Format(time.DateOnly) + "|" + id.String()))
}

func decodeCursor(s string) (time.Time, uuid.UUID, error) {
	errBad := problem.Validation(problem.FieldError{
		Field: "cursor", Code: "invalid_format", Message: "Некорректный курсор.",
	})
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return time.Time{}, uuid.Nil, errBad
	}
	dateStr, idStr, ok := strings.Cut(string(raw), "|")
	if !ok || !isValidDate(dateStr) {
		return time.Time{}, uuid.Nil, errBad
	}
	date, _ := time.Parse(time.DateOnly, dateStr) // формат проверен выше
	id, err := uuid.Parse(idStr)
	if err != nil {
		return time.Time{}, uuid.Nil, errBad
	}
	return date, id, nil
}

// readTx открывает транзакцию только для чтения с уровнем REPEATABLE READ:
// все запросы внутри видят один снимок БД, поэтому итоги дней в ответе
// ленты точно соответствуют её строкам, даже если между запросами кто-то
// добавил операцию.
func (s *server) readTx(ctx context.Context, fn func(q *dbgen.Queries) error) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(s.q.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *server) ListTransactions(ctx context.Context, req oapi.ListTransactionsRequestObject) (oapi.ListTransactionsResponseObject, error) {
	p := currentUser(ctx)
	prm := req.Params
	f := newTxFilters(prm.From, prm.To, prm.Kind, prm.AccountId, prm.CategoryId, prm.AuthorId, prm.Q)
	limit := feedDefaultLimit
	if prm.Limit != nil {
		limit = min(*prm.Limit, feedMaxLimit) // 1..200 проверил контракт
	}
	var cursorDate *time.Time
	var cursorID *uuid.UUID
	if prm.Cursor != nil {
		d, id, err := decodeCursor(*prm.Cursor)
		if err != nil {
			return nil, err
		}
		cursorDate, cursorID = &d, &id
	}

	resp := oapi.ListTransactions200JSONResponse{}
	err := s.readTx(ctx, func(q *dbgen.Queries) error {
		// На одну строку больше страницы: так без отдельного COUNT понятно,
		// есть ли следующая страница.
		rows, err := q.ListTransactions(ctx, dbgen.ListTransactionsParams{
			FamilyID: p.FamilyID, UserID: p.UserID,
			DateFrom: f.from, DateTo: f.to, Kinds: f.kinds, AccountIds: f.accounts,
			CategoryIds: f.categories, AuthorIds: f.authors, Search: f.search,
			CursorDate: cursorDate, CursorID: cursorID, RowLimit: int32(limit + 1),
		})
		if err != nil {
			return fmt.Errorf("list transactions: %w", err)
		}
		if len(rows) > limit {
			last := rows[limit-1]
			next := encodeCursor(last.OpDate, last.ID)
			resp.NextCursor = &next
			rows = rows[:limit]
		}

		resp.Items = make([]oapi.Transaction, 0, len(rows))
		var dates []time.Time
		for _, r := range rows {
			resp.Items = append(resp.Items, transactionToAPI(txRow(r), p.UserID))
			// Строки отсортированы по дате, поэтому одинаковые даты идут подряд.
			if len(dates) == 0 || !dates[len(dates)-1].Equal(r.OpDate) {
				dates = append(dates, r.OpDate)
			}
		}

		resp.Days = make([]oapi.TransactionDay, 0, len(dates))
		if len(dates) == 0 {
			return nil // пустой only_dates в запросе итогов значит «все даты»
		}
		totals, err := q.TransactionDayTotals(ctx, dbgen.TransactionDayTotalsParams{
			FamilyID: p.FamilyID, UserID: p.UserID,
			DateFrom: f.from, DateTo: f.to, Kinds: f.kinds, AccountIds: f.accounts,
			CategoryIds: f.categories, AuthorIds: f.authors, Search: f.search,
			OnlyDates: dates,
		})
		if err != nil {
			return fmt.Errorf("transaction day totals: %w", err)
		}
		byDate := make(map[time.Time][]oapi.CurrencyTotal, len(dates))
		for _, t := range totals {
			byDate[t.OpDate] = append(byDate[t.OpDate], oapi.CurrencyTotal{
				Currency: t.CurrencyCode, Expense: t.Expense, Income: t.Income,
			})
		}
		for _, d := range dates {
			dayTotals := byDate[d]
			if dayTotals == nil {
				dayTotals = []oapi.CurrencyTotal{} // в JSON — [], а не null
			}
			resp.Days = append(resp.Days, oapi.TransactionDay{Date: openapi_types.Date{Time: d}, Totals: dayTotals})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func (s *server) GetTransactionsSummary(ctx context.Context, req oapi.GetTransactionsSummaryRequestObject) (oapi.GetTransactionsSummaryResponseObject, error) {
	p := currentUser(ctx)
	prm := req.Params
	f := newTxFilters(prm.From, prm.To, prm.Kind, prm.AccountId, prm.CategoryId, prm.AuthorId, prm.Q)
	rows, err := s.q.TransactionDayTotals(ctx, dbgen.TransactionDayTotalsParams{
		FamilyID: p.FamilyID, UserID: p.UserID,
		DateFrom: f.from, DateTo: f.to, Kinds: f.kinds, AccountIds: f.accounts,
		CategoryIds: f.categories, AuthorIds: f.authors, Search: f.search,
	})
	if err != nil {
		return nil, fmt.Errorf("transactions summary: %w", err)
	}
	// Дневные итоги складываются по валютам. Переполнение int64 здесь
	// недостижимо: сумма операции ≤ 10^13, а int64 вмещает ~9·10^18.
	byCurrency := map[string]*oapi.CurrencyTotal{}
	for _, r := range rows {
		t := byCurrency[r.CurrencyCode]
		if t == nil {
			t = &oapi.CurrencyTotal{Currency: r.CurrencyCode}
			byCurrency[r.CurrencyCode] = t
		}
		t.Expense += r.Expense
		t.Income += r.Income
	}
	totals := make([]oapi.CurrencyTotal, 0, len(byCurrency))
	for _, t := range byCurrency {
		totals = append(totals, *t)
	}
	slices.SortFunc(totals, func(a, b oapi.CurrencyTotal) int { return strings.Compare(a.Currency, b.Currency) })
	return oapi.GetTransactionsSummary200JSONResponse{Totals: totals}, nil
}

func (s *server) GetTransaction(ctx context.Context, req oapi.GetTransactionRequestObject) (oapi.GetTransactionResponseObject, error) {
	p := currentUser(ctx)
	row, err := getTxRow(ctx, s.q, p, req.TransactionId)
	if err != nil {
		return nil, err
	}
	if row.DeletedAt != nil {
		return nil, errTransactionNotFound()
	}
	return oapi.GetTransaction200JSONResponse(transactionToAPI(row, p.UserID)), nil
}

func (s *server) GetTransactionDefaults(ctx context.Context, _ oapi.GetTransactionDefaultsRequestObject) (oapi.GetTransactionDefaultsResponseObject, error) {
	p := currentUser(ctx)
	today, err := s.userToday(ctx, p.UserID)
	if err != nil {
		return nil, err
	}
	resp := oapi.GetTransactionDefaults200JSONResponse{
		FrequentCategories: oapi.FrequentCategories{Expense: []uuid.UUID{}, Income: []uuid.UUID{}},
	}
	err = s.readTx(ctx, func(q *dbgen.Queries) error {
		for _, k := range []struct {
			kind dbgen.TransactionKind
			dst  **uuid.UUID
		}{
			{dbgen.TransactionKindExpense, &resp.ExpenseAccountId},
			{dbgen.TransactionKindIncome, &resp.IncomeAccountId},
		} {
			id, err := q.LastTransactionAccount(ctx, dbgen.LastTransactionAccountParams{
				FamilyID: p.FamilyID, UserID: p.UserID, Kind: k.kind,
			})
			switch {
			case errors.Is(err, pgx.ErrNoRows): // операций нет — null
			case err != nil:
				return fmt.Errorf("last transaction account: %w", err)
			default:
				*k.dst = &id
			}
		}

		pair, err := q.LastTransferAccounts(ctx, dbgen.LastTransferAccountsParams{FamilyID: p.FamilyID, UserID: p.UserID})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
		case err != nil:
			return fmt.Errorf("last transfer accounts: %w", err)
		default:
			resp.Transfer = &oapi.TransferAccounts{AccountId: pair.AccountID, ToAccountId: pair.ToAccountID}
		}

		cats, err := q.FrequentCategories(ctx, dbgen.FrequentCategoriesParams{
			FamilyID: p.FamilyID, UserID: p.UserID,
			DateFrom: today.AddDate(0, 0, -(frequentCategoriesDays - 1)), Today: today,
		})
		if err != nil {
			return fmt.Errorf("frequent categories: %w", err)
		}
		fc := &resp.FrequentCategories
		for _, c := range cats { // уже по убыванию частоты
			dst := &fc.Expense
			if c.Kind == dbgen.CategoryKindIncome {
				dst = &fc.Income
			}
			if len(*dst) < frequentCategoriesLimit {
				*dst = append(*dst, c.ID)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// userToday — «сегодня» в часовом поясе пользователя (полночь UTC, как date).
func (s *server) userToday(ctx context.Context, userID uuid.UUID) (time.Time, error) {
	tz, err := s.q.GetUserTimezone(ctx, userID)
	if err != nil {
		return time.Time{}, fmt.Errorf("get user timezone: %w", err)
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		// Пояс проверяется при регистрации, сюда попасть не должны.
		return time.Time{}, fmt.Errorf("load user timezone %q: %w", tz, err)
	}
	return dateIn(s.now(), loc), nil
}

// getTxRow читает видимую операцию (в т. ч. удалённую); нет — 404.
func getTxRow(ctx context.Context, q *dbgen.Queries, p Principal, id uuid.UUID) (txRow, error) {
	row, err := q.GetTransaction(ctx, dbgen.GetTransactionParams{FamilyID: p.FamilyID, ID: id, UserID: p.UserID})
	if errors.Is(err, pgx.ErrNoRows) {
		return row, errTransactionNotFound()
	}
	if err != nil {
		return row, fmt.Errorf("get transaction: %w", err)
	}
	return row, nil
}

// accountVisible — счёт общий или личный пользователя userID.
func accountVisible(owner *uuid.UUID, userID uuid.UUID) bool {
	return owner == nil || *owner == userID
}

// fullyVisible — пользователь видит все счета операции. Только тогда он может
// её править, удалять и восстанавливать.
func fullyVisible(r txRow, userID uuid.UUID) bool {
	return accountVisible(r.AccountOwnerID, userID) &&
		(r.ToAccountID == nil || accountVisible(r.ToAccountOwnerID, userID))
}

// abs — модуль суммы. В БД расход и списание перевода хранятся со знаком
// минус, в API суммы положительные.
func abs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

// apiAmount — сумма account_id для API: положительная, у корректировки —
// со знаком (это изменение остатка, направление важно, а вида «в плюс /
// в минус» у неё нет).
func apiAmount(kind dbgen.TransactionKind, amount int64) int64 {
	if kind == dbgen.TransactionKindAdjustment {
		return amount
	}
	return abs(amount)
}

// transactionToAPI преобразует строку в ответ для пользователя userID:
// сторону перевода на невидимом ему личном счёте скрывает, вместо неё —
// владелец этого счёта (counterparty).
func transactionToAPI(r txRow, userID uuid.UUID) oapi.Transaction {
	t := oapi.Transaction{
		Id:         r.ID,
		Kind:       oapi.TransactionKind(r.Kind),
		Date:       openapi_types.Date{Time: r.OpDate},
		CategoryId: r.CategoryID,
		Comment:    r.Comment,
		CreatedAt:  r.CreatedAt.UTC(),
		UpdatedAt:  r.UpdatedAt.UTC(),
		Editable:   r.Kind != dbgen.TransactionKindAdjustment && fullyVisible(r, userID),
	}
	if r.CreatedBy != nil && r.AuthorName != nil {
		t.Author = &oapi.TransactionUser{Id: *r.CreatedBy, Name: *r.AuthorName}
	}
	if accountVisible(r.AccountOwnerID, userID) {
		id, amount, currency := r.AccountID, apiAmount(r.Kind, r.Amount), r.Currency
		t.AccountId, t.Amount, t.Currency = &id, &amount, &currency
	} else {
		t.Counterparty = ownerRef(r.AccountOwnerID, r.AccountOwnerName)
	}
	if r.ToAccountID != nil {
		if accountVisible(r.ToAccountOwnerID, userID) {
			t.ToAccountId, t.ToAmount, t.ToCurrency = r.ToAccountID, r.ToAmount, r.ToCurrency
		} else {
			t.Counterparty = ownerRef(r.ToAccountOwnerID, r.ToAccountOwnerName)
		}
	}
	return t
}

func ownerRef(id *uuid.UUID, name *string) *oapi.TransactionUser {
	if id == nil || name == nil {
		return nil // не бывает: невидимый счёт — личный, у него есть владелец
	}
	return &oapi.TransactionUser{Id: *id, Name: *name}
}

// ---------------------------------------------------------------------------
// Журнал изменений
// ---------------------------------------------------------------------------

// transactionSnapshot — снимок операции для audit_log: формат Transaction
// из API, но без вычисляемых полей (editable, имена людей, counterparty) и
// всегда полный — журнал пишет только тот, кто видит все счета операции.
type transactionSnapshot struct {
	ID          uuid.UUID  `json:"id"`
	Kind        string     `json:"kind"`
	Date        string     `json:"date"`
	AccountID   uuid.UUID  `json:"accountId"`
	Amount      int64      `json:"amount"`
	Currency    string     `json:"currency"`
	ToAccountID *uuid.UUID `json:"toAccountId"`
	ToAmount    *int64     `json:"toAmount"`
	ToCurrency  *string    `json:"toCurrency"`
	CategoryID  *uuid.UUID `json:"categoryId"`
	Comment     string     `json:"comment"`
	AuthorID    *uuid.UUID `json:"authorId"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

func snapshotOf(r *txRow) ([]byte, error) {
	if r == nil {
		return nil, nil // NULL в before/after
	}
	return json.Marshal(transactionSnapshot{
		ID:          r.ID,
		Kind:        string(r.Kind),
		Date:        r.OpDate.Format(time.DateOnly),
		AccountID:   r.AccountID,
		Amount:      apiAmount(r.Kind, r.Amount),
		Currency:    r.Currency,
		ToAccountID: r.ToAccountID,
		ToAmount:    r.ToAmount,
		ToCurrency:  r.ToCurrency,
		CategoryID:  r.CategoryID,
		Comment:     r.Comment,
		AuthorID:    r.CreatedBy,
		CreatedAt:   r.CreatedAt.UTC(),
		UpdatedAt:   r.UpdatedAt.UTC(),
	})
}

// writeTransactionAudit пишет запись журнала об операции; before / after —
// состояния до и после (nil — нет).
func (s *server) writeTransactionAudit(ctx context.Context, q *dbgen.Queries, p Principal,
	action dbgen.AuditAction, before, after *txRow,
) error {
	b, err := snapshotOf(before)
	if err != nil {
		return err
	}
	a, err := snapshotOf(after)
	if err != nil {
		return err
	}
	id := before
	if id == nil {
		id = after
	}
	actor := p.UserID
	if err := q.InsertAuditLog(ctx, dbgen.InsertAuditLogParams{
		FamilyID: p.FamilyID, ActorUserID: &actor, EntityType: "transaction", EntityID: id.ID,
		Action: action, Before: b, After: a, Now: s.now(),
	}); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Запись
// ---------------------------------------------------------------------------

// txInput — проверенное тело создания или правки, суммы уже со знаком БД.
type txInput struct {
	kind        dbgen.TransactionKind
	date        time.Time
	accountID   uuid.UUID
	amount      int64
	toAccountID *uuid.UUID
	toAmount    *int64
	categoryID  *uuid.UUID
	comment     string
}

func fieldErr(field, code, msg string) problem.FieldError {
	return problem.FieldError{Field: field, Code: code, Message: msg}
}

// parseTxRequest проверяет то, что не выражено схемой и не зависит от данных:
// какие поля обязательны и запрещены для вида операции, комментарий.
func parseTxRequest(b oapi.TransactionRequest) (txInput, error) {
	in := txInput{
		kind:        dbgen.TransactionKind(b.Kind),
		date:        b.Date.Time,
		accountID:   b.AccountId,
		amount:      b.Amount,
		toAccountID: b.ToAccountId,
		toAmount:    b.ToAmount,
		categoryID:  b.CategoryId,
	}
	var errs []problem.FieldError
	switch in.kind {
	case dbgen.TransactionKindExpense, dbgen.TransactionKindIncome:
		if in.categoryID == nil {
			errs = append(errs, fieldErr("categoryId", "required", "Выберите категорию."))
		}
		if in.toAccountID != nil {
			errs = append(errs, fieldErr("toAccountId", "not_allowed", "Счёт зачисления бывает только у перевода."))
		}
		if in.toAmount != nil {
			errs = append(errs, fieldErr("toAmount", "not_allowed", "Сумма зачисления бывает только у перевода."))
		}
	case dbgen.TransactionKindTransfer:
		if in.categoryID != nil {
			errs = append(errs, fieldErr("categoryId", "not_allowed", "У перевода нет категории."))
		}
		switch {
		case in.toAccountID == nil:
			errs = append(errs, fieldErr("toAccountId", "required", "Выберите счёт зачисления."))
		case *in.toAccountID == in.accountID:
			errs = append(errs, fieldErr("toAccountId", "same_account", "Счета списания и зачисления совпадают."))
		}
	}
	if b.Comment != nil {
		in.comment = strings.TrimSpace(*b.Comment)
		if strings.ContainsFunc(in.comment, isForbiddenCommentRune) {
			errs = append(errs, fieldErr("comment", "invalid_format", "Комментарий содержит недопустимые символы."))
		}
	}
	if len(errs) > 0 {
		return in, problem.Validation(errs...)
	}
	return in, nil
}

// isForbiddenCommentRune — управляющие символы, кроме переносов строк и
// табуляции (их могут вставить из буфера обмена). NUL Postgres в text не
// принимает вовсе — запрос упал бы с 500.
func isForbiddenCommentRune(r rune) bool {
	return unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t'
}

// resolveTx проверяет счета и категорию (под блокировкой категорий семьи) и
// расставляет знаки сумм. old — правка: счёт или категория, которые уже были
// у операции, могут быть в архиве (старую операцию на архивном счёте можно
// поправить). Ошибки по всем полям собираются вместе.
func resolveTx(ctx context.Context, q *dbgen.Queries, p Principal, in txInput, old *txRow) (txInput, error) {
	var errs []problem.FieldError
	unchangedAccount := func(id uuid.UUID) bool {
		return old != nil && (old.AccountID == id || (old.ToAccountID != nil && *old.ToAccountID == id))
	}
	// account читает счёт; не подходит — ошибка поля и ok = false. Счёт чужой
	// семьи, чужой личный и несуществующий неразличимы.
	account := func(field string, id uuid.UUID) (a dbgen.GetVisibleAccountRow, ok bool, err error) {
		a, err = q.GetVisibleAccount(ctx, dbgen.GetVisibleAccountParams{FamilyID: p.FamilyID, ID: id, UserID: p.UserID})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return a, false, fmt.Errorf("get account: %w", err)
		}
		if err != nil || (a.ArchivedAt != nil && !unchangedAccount(id)) {
			errs = append(errs, fieldErr(field, "invalid_account", "Этот счёт нельзя выбрать."))
			return a, false, nil
		}
		return a, true, nil
	}

	from, fromOK, err := account("accountId", in.accountID)
	if err != nil {
		return in, err
	}
	switch in.kind {
	case dbgen.TransactionKindExpense:
		in.amount = -in.amount
	case dbgen.TransactionKindTransfer:
		to, toOK, err := account("toAccountId", *in.toAccountID)
		if err != nil {
			return in, err
		}
		if fromOK && toOK {
			switch {
			case from.CurrencyCode == to.CurrencyCode && in.toAmount == nil:
				in.toAmount = &in.amount
			case from.CurrencyCode == to.CurrencyCode && *in.toAmount != in.amount:
				errs = append(errs, fieldErr("toAmount", "to_amount_mismatch",
					"Счета в одной валюте: сумма зачисления равна сумме списания."))
			case from.CurrencyCode != to.CurrencyCode && in.toAmount == nil:
				errs = append(errs, fieldErr("toAmount", "required", "Укажите сумму зачисления."))
			}
		}
		if in.toAmount != nil {
			v := *in.toAmount // копия: in.toAmount может указывать на in.amount
			in.toAmount = &v
		}
		in.amount = -in.amount
	}

	if in.categoryID != nil {
		c, err := q.GetCategory(ctx, dbgen.GetCategoryParams{FamilyID: p.FamilyID, ID: *in.categoryID})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return in, fmt.Errorf("get category: %w", err)
		}
		unchanged := old != nil && old.CategoryID != nil && *old.CategoryID == *in.categoryID
		if err != nil || string(c.Kind) != string(in.kind) || (c.ArchivedAt != nil && !unchanged) {
			errs = append(errs, fieldErr("categoryId", "invalid_category", "Эту категорию нельзя выбрать."))
		}
	}
	if len(errs) > 0 {
		return in, problem.Validation(errs...)
	}
	return in, nil
}

// inTransactionWriteTx выполняет fn в транзакции под разделяемой блокировкой
// категорий семьи (LockFamilyCategoriesShared): операции пишутся параллельно,
// но не одновременно со слиянием, архивом и прочими изменениями категорий,
// поэтому проверенная в fn категория не исчезнет до коммита (техдолг №30).
func (s *server) inTransactionWriteTx(ctx context.Context, familyID uuid.UUID, fn func(q *dbgen.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := q.LockFamilyCategoriesShared(ctx, familyID); err != nil {
		return fmt.Errorf("lock categories shared: %w", err)
	}
	if err := fn(q); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// writeErr превращает нарушение внешнего ключа (счёт удалили параллельно —
// между проверкой и записью) в ошибку поля, остальное — в 500.
func writeErr(err error, op string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == foreignKeyViolation {
		switch pgErr.ConstraintName {
		case fkTransactionAccount:
			return problem.Validation(fieldErr("accountId", "invalid_account", "Этот счёт нельзя выбрать."))
		case fkTransactionToAccount:
			return problem.Validation(fieldErr("toAccountId", "invalid_account", "Этот счёт нельзя выбрать."))
		case fkTransactionCategory:
			return problem.Validation(fieldErr("categoryId", "invalid_category", "Эту категорию нельзя выбрать."))
		}
	}
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

func (s *server) CreateTransaction(ctx context.Context, req oapi.CreateTransactionRequestObject) (oapi.CreateTransactionResponseObject, error) {
	p := currentUser(ctx)
	in, err := parseTxRequest(*req.Body)
	if err != nil {
		return nil, err
	}
	var created txRow
	err = s.inTransactionWriteTx(ctx, p.FamilyID, func(q *dbgen.Queries) error {
		in, err := resolveTx(ctx, q, p, in, nil)
		if err != nil {
			return err
		}
		id, err := q.InsertTransaction(ctx, dbgen.InsertTransactionParams{
			FamilyID: p.FamilyID, Kind: in.kind, AccountID: in.accountID, Amount: in.amount,
			ToAccountID: in.toAccountID, ToAmount: in.toAmount, CategoryID: in.categoryID,
			OpDate: in.date, Comment: in.comment, CreatedBy: p.UserID, Now: s.now(),
		})
		if err := writeErr(err, "insert transaction"); err != nil {
			return err
		}
		if created, err = getTxRow(ctx, q, p, id); err != nil {
			return err
		}
		return s.writeTransactionAudit(ctx, q, p, dbgen.AuditActionCreate, nil, &created)
	})
	if err != nil {
		return nil, err
	}
	return oapi.CreateTransaction201JSONResponse(transactionToAPI(created, p.UserID)), nil
}

// lockForWrite блокирует видимую операцию и проверяет права на изменение:
// удалённая (если allowDeleted = false) — 404, видны не все счета — 403.
func lockForWrite(ctx context.Context, q *dbgen.Queries, p Principal, id uuid.UUID, allowDeleted bool) (txRow, error) {
	_, err := q.LockTransaction(ctx, dbgen.LockTransactionParams{FamilyID: p.FamilyID, ID: id, UserID: p.UserID})
	if errors.Is(err, pgx.ErrNoRows) {
		return txRow{}, errTransactionNotFound()
	}
	if err != nil {
		return txRow{}, fmt.Errorf("lock transaction: %w", err)
	}
	row, err := getTxRow(ctx, q, p, id)
	if err != nil {
		return row, err
	}
	if row.DeletedAt != nil && !allowDeleted {
		return row, errTransactionNotFound()
	}
	if !fullyVisible(row, p.UserID) {
		return row, errTransactionReadonly()
	}
	return row, nil
}

func (s *server) UpdateTransaction(ctx context.Context, req oapi.UpdateTransactionRequestObject) (oapi.UpdateTransactionResponseObject, error) {
	p := currentUser(ctx)
	in, err := parseTxRequest(*req.Body)
	if err != nil {
		return nil, err
	}
	var updated txRow
	err = s.inTransactionWriteTx(ctx, p.FamilyID, func(q *dbgen.Queries) error {
		old, err := lockForWrite(ctx, q, p, req.TransactionId, false)
		if err != nil {
			return err
		}
		if old.Kind == dbgen.TransactionKindAdjustment {
			return problem.Conflict(problem.CodeAdjustmentReadonly,
				"Корректировку остатка нельзя изменить — только удалить.")
		}
		in, err := resolveTx(ctx, q, p, in, &old)
		if err != nil {
			return err
		}
		err = q.UpdateTransaction(ctx, dbgen.UpdateTransactionParams{
			Kind: in.kind, AccountID: in.accountID, Amount: in.amount,
			ToAccountID: in.toAccountID, ToAmount: in.toAmount, CategoryID: in.categoryID,
			OpDate: in.date, Comment: in.comment, Now: s.now(), FamilyID: p.FamilyID, ID: old.ID,
		})
		if err := writeErr(err, "update transaction"); err != nil {
			return err
		}
		if updated, err = getTxRow(ctx, q, p, old.ID); err != nil {
			return err
		}
		return s.writeTransactionAudit(ctx, q, p, dbgen.AuditActionUpdate, &old, &updated)
	})
	if err != nil {
		return nil, err
	}
	return oapi.UpdateTransaction200JSONResponse(transactionToAPI(updated, p.UserID)), nil
}

func (s *server) DeleteTransaction(ctx context.Context, req oapi.DeleteTransactionRequestObject) (oapi.DeleteTransactionResponseObject, error) {
	p := currentUser(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// Блокировка категорий не нужна: удаление категорию не проверяет, а
	// слияние переносит и удалённые операции.
	old, err := lockForWrite(ctx, q, p, req.TransactionId, false)
	if err != nil {
		return nil, err
	}
	now := s.now()
	if err := q.SetTransactionDeleted(ctx, dbgen.SetTransactionDeletedParams{
		DeletedAt: &now, Now: now, FamilyID: p.FamilyID, ID: old.ID,
	}); err != nil {
		return nil, fmt.Errorf("delete transaction: %w", err)
	}
	if err := s.writeTransactionAudit(ctx, q, p, dbgen.AuditActionDelete, &old, nil); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit delete transaction: %w", err)
	}
	return oapi.DeleteTransaction204Response{}, nil
}

func (s *server) RestoreTransaction(ctx context.Context, req oapi.RestoreTransactionRequestObject) (oapi.RestoreTransactionResponseObject, error) {
	p := currentUser(ctx)
	var restored txRow
	err := s.inTransactionWriteTx(ctx, p.FamilyID, func(q *dbgen.Queries) error {
		old, err := lockForWrite(ctx, q, p, req.TransactionId, true)
		if err != nil {
			return err
		}
		if old.DeletedAt == nil {
			restored = old // уже восстановлена: идемпотентно, без записи в журнал
			return nil
		}
		if err := q.SetTransactionDeleted(ctx, dbgen.SetTransactionDeletedParams{
			DeletedAt: nil, Now: s.now(), FamilyID: p.FamilyID, ID: old.ID,
		}); err != nil {
			return fmt.Errorf("restore transaction: %w", err)
		}
		if restored, err = getTxRow(ctx, q, p, old.ID); err != nil {
			return err
		}
		return s.writeTransactionAudit(ctx, q, p, dbgen.AuditActionRestore, nil, &restored)
	})
	if err != nil {
		return nil, err
	}
	return oapi.RestoreTransaction200JSONResponse(transactionToAPI(restored, p.UserID)), nil
}
