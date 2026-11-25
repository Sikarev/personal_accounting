package httpapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"personal-accounting/api/internal/ratelimit"
)

// --- Помощники ---------------------------------------------------------------

const bom = "\xEF\xBB\xBF"

// parseExportCSV проверяет формат файла (BOM, CRLF) и разбирает его так же,
// как это сделал бы Excel по-русски: разделитель «;».
func parseExportCSV(t *testing.T, raw []byte) [][]string {
	t.Helper()
	if !bytes.HasPrefix(raw, []byte(bom)) {
		t.Fatalf("нет BOM: %q", raw[:min(len(raw), 20)])
	}
	body := raw[len(bom):]
	if !bytes.HasSuffix(body, []byte("\r\n")) {
		t.Fatalf("файл не кончается CRLF: %q", body)
	}
	// Переводы строки вне кавычек — только CRLF: одиночный \n бывает только
	// внутри поля в кавычках, а encoding/csv при записи и там пишет \r\n.
	if bytes.Contains(bytes.ReplaceAll(body, []byte("\r\n"), nil), []byte("\n")) {
		t.Fatalf("есть перевод строки без \\r: %q", body)
	}
	r := csv.NewReader(bytes.NewReader(body))
	r.Comma = ';'
	recs, err := r.ReadAll()
	if err != nil {
		t.Fatalf("CSV не разбирается: %v\n%s", err, body)
	}
	return recs
}

// exportTx — GET /export/transactions?query: проверяет заголовки ответа и
// возвращает сырой файл.
func (e authEnv) exportTxRaw(t *testing.T, u accUser, query string) []byte {
	t.Helper()
	rec := e.as(u, http.MethodGet, "/export/transactions?"+query, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("экспорт ?%s: %d %s", query, rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/csv; charset=utf-8" {
		t.Fatalf("Content-Type = %q", ct)
	}
	cd := rec.Header().Get("Content-Disposition")
	if !regexp.MustCompile(`^attachment; filename="operations-\d{4}-\d{2}-\d{2}\.csv"$`).MatchString(cd) {
		t.Fatalf("Content-Disposition = %q", cd)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("Cache-Control = %q", cc)
	}
	return rec.Body.Bytes()
}

// exportTx — строки файла операций без заголовка; заголовок проверяется.
func (e authEnv) exportTx(t *testing.T, u accUser, query string) [][]string {
	t.Helper()
	recs := parseExportCSV(t, e.exportTxRaw(t, u, query))
	if len(recs) == 0 || !slices.Equal(recs[0], exportTxHeader) {
		t.Fatalf("заголовок: %q", recs)
	}
	return recs[1:]
}

// exportAll — GET /export/all: файлы архива по именам.
func (e authEnv) exportAll(t *testing.T, u accUser) map[string][]byte {
	t.Helper()
	rec := e.as(u, http.MethodGet, "/export/all", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("полный экспорт: %d %s", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/zip" {
		t.Fatalf("Content-Type = %q", ct)
	}
	cd := rec.Header().Get("Content-Disposition")
	if !regexp.MustCompile(`^attachment; filename="export-\d{4}-\d{2}-\d{2}\.zip"$`).MatchString(cd) {
		t.Fatalf("Content-Disposition = %q", cd)
	}
	zr, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	if err != nil {
		t.Fatalf("не zip: %v", err)
	}
	files := map[string][]byte{}
	var names []string
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		b, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			t.Fatal(err)
		}
		files[f.Name] = b
		names = append(names, f.Name)
	}
	if !slices.Equal(names, []string{"accounts.csv", "categories.csv", "transactions.csv"}) {
		t.Fatalf("файлы архива: %v", names)
	}
	return files
}

// column — значения колонки name по строкам (без заголовка).
func column(rows [][]string, name string) []string {
	i := slices.Index(exportTxHeader, name)
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r[i])
	}
	return out
}

// rowMap — строка как «колонка → значение», для читаемых проверок.
func rowMap(header, row []string) map[string]string {
	m := make(map[string]string, len(header))
	for i, h := range header {
		m[h] = row[i]
	}
	return m
}

func wantRow(t *testing.T, what string, got map[string]string, want map[string]string) {
	t.Helper()
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s: %q = %q, ожидалось %q (строка %v)", what, k, got[k], v, got)
		}
	}
}

// --- Формат и виды операций ---------------------------------------------------

func TestExportTransactionsFormat(t *testing.T) {
	e := newAuthEnv(t, Options{})
	e.ensureTestCurrency(t)
	u := e.newUser(t)
	rub := e.createAccount(t, u, accountBody("Кошелёк", "shared", 0))["id"].(string)
	usd := e.createAccount(t, u, usdAccountBody("Карта $", "shared"))["id"].(string)
	xts := e.createAccount(t, u, accountBody("Без копеек", "shared", 0))["id"].(string)
	e.setAccountCurrency(t, xts, testCurrency)
	taxi := e.catID(t, u.familyID, "expense", "Такси")
	salary := e.catID(t, u.familyID, "income", "Зарплата")

	exp := expenseReq(rub, taxi, 123450, "2026-03-05")
	exp.Comment = "поездка; \"срочно\"\nвторая строка"
	expense := e.createTx(t, u, exp)
	inc := incomeReq(usd, salary, 5, "2026-03-04")
	inc.Comment = "=1+1"
	e.createTx(t, u, inc)
	tr := transferReq(rub, usd, 900000, "2026-03-03")
	tr.ToAmount = 10000
	tr.Comment = "-обмен"
	e.createTx(t, u, tr)
	e.createTx(t, u, expenseReq(xts, taxi, 7, "2026-03-02"))
	deleted := e.createTxID(t, u, expenseReq(rub, taxi, 1, "2026-03-01"))
	if rec := e.as(u, http.MethodDelete, "/transactions/"+deleted, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("удаление: %d", rec.Code)
	}
	// Корректировка: остаток RUB сейчас −1234,50 − 9000,00 = −10234,50 → 0.
	if rec := e.as(u, http.MethodPost, "/accounts/"+rub+"/adjust-balance", `{"balance":0}`); rec.Code != http.StatusOK {
		t.Fatalf("корректировка: %d %s", rec.Code, rec.Body)
	}

	rows := e.exportTx(t, u, "")
	if len(rows) != 5 {
		t.Fatalf("строк %d, ожидалось 5 (удалённая не выгружается): %q", len(rows), rows)
	}
	// Порядок — как в ленте: дата ↓. Корректировка — «сегодня», она первая.
	got := func(i int) map[string]string { return rowMap(exportTxHeader, rows[i]) }
	wantRow(t, "корректировка", got(0), map[string]string{
		"Вид": "Корректировка", "Счёт": "Кошелёк", "Сумма": "10234,50", "Валюта": "RUB",
		"Категория": "", "Счёт зачисления": "", "Автор": "Иван",
	})
	wantRow(t, "расход", got(1), map[string]string{
		"Дата": "05.03.2026", "Вид": "Расход", "Счёт": "Кошелёк", "Сумма": "-1234,50", "Валюта": "RUB",
		"Счёт зачисления": "", "Сумма зачисления": "", "Валюта зачисления": "", "Личный счёт участника": "",
		"Категория": "Транспорт", "Подкатегория": "Такси",
		"Комментарий": "поездка; \"срочно\"\nвторая строка", "Автор": "Иван",
	})
	wantRow(t, "доход", got(2), map[string]string{
		"Дата": "04.03.2026", "Вид": "Доход", "Счёт": "Карта $", "Сумма": "0,05", "Валюта": "USD",
		"Категория": "Зарплата", "Подкатегория": "", "Комментарий": "'=1+1",
	})
	wantRow(t, "перевод", got(3), map[string]string{
		"Дата": "03.03.2026", "Вид": "Перевод", "Счёт": "Кошелёк", "Сумма": "9000,00", "Валюта": "RUB",
		"Счёт зачисления": "Карта $", "Сумма зачисления": "100,00", "Валюта зачисления": "USD",
		"Категория": "", "Комментарий": "'-обмен",
	})
	wantRow(t, "валюта без копеек", got(4), map[string]string{
		"Дата": "02.03.2026", "Счёт": "Без копеек", "Сумма": "-7", "Валюта": testCurrency,
	})

	// «Создана» — в поясе пользователя (Europe/Moscow).
	created, err := time.Parse(time.RFC3339Nano, expense["createdAt"].(string))
	if err != nil {
		t.Fatal(err)
	}
	msk, _ := time.LoadLocation("Europe/Moscow")
	if want := created.In(msk).Format("02.01.2006 15:04"); got(1)["Создана"] != want {
		t.Errorf("Создана = %q, ожидалось %q", got(1)["Создана"], want)
	}

	// Ошибка в параметрах — обычный Problem JSON.
	decodeProblem(t, e.as(u, http.MethodGet, "/export/transactions?from=2026-02-31", ""),
		http.StatusUnprocessableEntity, "validation_failed")
	decodeProblem(t, e.send(http.MethodGet, "/api/v1/export/transactions", ""), http.StatusUnauthorized, "unauthorized")
}

// TestExportCSVInjection — текст пользователей, похожий на формулу, получает
// апостроф; суммы и даты сервера — нет.
func TestExportCSVInjection(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	acc := e.createAccount(t, u, accountBody("=HYPERLINK(\"http://x\")", "shared", -500))["id"].(string)
	products := e.catID(t, u.familyID, "expense", "Продукты")
	if rec := e.as(u, http.MethodPut, "/categories/"+products, `{"name":"@SUM(A1)"}`); rec.Code != http.StatusOK {
		t.Fatalf("переименование категории: %d %s", rec.Code, rec.Body)
	}
	if _, err := e.pool.Exec(context.Background(), `UPDATE users SET name = '+79990000000' WHERE id = $1`, u.id); err != nil {
		t.Fatal(err)
	}
	// Табуляцию в начале API обрезает (комментарий — без пробелов по краям),
	// её проверяет юнит-тест csvText.
	for _, c := range []string{"=1+1", "+1", "-1", "@A1", "обычный"} {
		r := expenseReq(acc, products, 100, "2026-03-01")
		r.Comment = c
		e.createTx(t, u, r)
	}
	rows := e.exportTx(t, u, "")
	comments := column(rows, "Комментарий")
	slices.Sort(comments)
	want := []string{"'+1", "'-1", "'=1+1", "'@A1", "обычный"}
	slices.Sort(want)
	if !slices.Equal(comments, want) {
		t.Errorf("комментарии: %q, ожидалось %q", comments, want)
	}
	r := rowMap(exportTxHeader, rows[0])
	wantRow(t, "строка", r, map[string]string{
		"Счёт": "'=HYPERLINK(\"http://x\")", "Категория": "'@SUM(A1)", "Автор": "'+79990000000",
		"Сумма": "-1,00", "Дата": "01.03.2026",
	})

	accounts := parseExportCSV(t, e.exportAll(t, u)["accounts.csv"])
	wantRow(t, "счёт", rowMap(exportAccountsHeader, accounts[1]), map[string]string{
		"Название": "'=HYPERLINK(\"http://x\")", "Начальный остаток": "-5,00", "Текущий остаток": "-10,00",
	})
}

// --- Фильтры -----------------------------------------------------------------

// TestExportFiltersMatchFeed — под каждым фильтром выгрузка — ровно лента
// (те же операции в том же порядке). Операции различаются комментарием.
func TestExportFiltersMatchFeed(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	other := e.addMember(t, u)
	a1 := e.createAccount(t, u, accountBody("Первый", "shared", 0))["id"].(string)
	a2 := e.createAccount(t, u, accountBody("Второй", "shared", 0))["id"].(string)
	transport := e.catID(t, u.familyID, "expense", "Транспорт")
	taxi := e.catID(t, u.familyID, "expense", "Такси")
	products := e.catID(t, u.familyID, "expense", "Продукты")
	salary := e.catID(t, u.familyID, "income", "Зарплата")

	mk := func(who accUser, r txReq, comment string) {
		r.Comment = comment
		e.createTx(t, who, r)
	}
	mk(u, expenseReq(a1, taxi, 100, "2026-01-10"), "такси")
	mk(u, expenseReq(a1, transport, 200, "2026-01-11"), "транспорт")
	mk(u, expenseReq(a2, products, 300, "2026-01-12"), "Ёлка")
	mk(other, incomeReq(a2, salary, 400, "2026-01-12"), "зарплата")
	mk(u, transferReq(a1, a2, 500, "2026-01-13"), "перевод")
	mk(other, expenseReq(a1, products, 600, "2026-02-01"), "февраль")

	for _, q := range []string{
		"",
		"kind=expense",
		"kind=income&kind=transfer",
		"accountId=" + a2,
		"categoryId=" + transport,
		"from=2026-01-11&to=2026-01-12",
		"authorId=" + other.id,
		"q=ел",
		"accountId=" + a1 + "&kind=expense&from=2026-01-11",
	} {
		var want []string
		for _, it := range e.feed(t, u, q+"&limit=200").Items {
			want = append(want, it["comment"].(string))
		}
		got := column(e.exportTx(t, u, q), "Комментарий")
		if !slices.Equal(got, want) && !(len(got) == 0 && len(want) == 0) {
			t.Errorf("?%s: выгрузка %q, лента %q", q, got, want)
		}
	}
}

// TestExportManyBatches — операций больше, чем в одной пачке чтения:
// все на месте, без повторов, в порядке ленты.
func TestExportManyBatches(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	acc := e.createAccount(t, u, accountBody("Счёт", "shared", 0))["id"].(string)
	n := exportBatchSize*2 + 1
	// Пачкой одним запросом: через API 2001 операция шла бы долго. Даты
	// повторяются, чтобы граница пачки проходила внутри дня.
	if _, err := e.pool.Exec(context.Background(), `
		INSERT INTO transactions (family_id, kind, account_id, amount, category_id, op_date, comment, created_by)
		SELECT $1, 'expense', $2, -g, (SELECT id FROM categories WHERE family_id = $1 AND kind = 'expense' LIMIT 1),
		       date '2026-01-01' + (g % 7), g::text, $3
		FROM generate_series(1, $4::int) g`, u.familyID, acc, u.id, n); err != nil {
		t.Fatal(err)
	}
	rows := e.exportTx(t, u, "")
	if len(rows) != n {
		t.Fatalf("строк %d, ожидалось %d", len(rows), n)
	}
	var want []string
	q := "limit=200"
	for {
		p := e.feed(t, u, q)
		for _, it := range p.Items {
			want = append(want, it["comment"].(string))
		}
		if p.NextCursor == nil {
			break
		}
		q = "limit=200&cursor=" + *p.NextCursor
	}
	if got := column(rows, "Комментарий"); !slices.Equal(got, want) {
		t.Fatal("порядок выгрузки не совпадает с лентой")
	}
}

// --- Видимость и изоляция ----------------------------------------------------

func TestExportVisibility(t *testing.T) {
	e := newAuthEnv(t, Options{})
	owner := e.newUser(t)
	member := e.addMember(t, owner)
	if _, err := e.pool.Exec(context.Background(), `UPDATE users SET name = 'Мария' WHERE id = $1`, member.id); err != nil {
		t.Fatal(err)
	}
	shared := e.createAccount(t, owner, accountBody("Общий", "shared", 0))["id"].(string)
	private := e.createAccount(t, member, accountBody("Тайный", "private", 1000))["id"].(string)
	products := e.catID(t, owner.familyID, "expense", "Продукты")

	r := expenseReq(private, products, 100, "2026-04-01")
	r.Comment = "секрет"
	e.createTx(t, member, r)
	toShared := transferReq(private, shared, 500, "2026-04-02")
	toShared.Comment = "в общий"
	e.createTx(t, member, toShared)
	fromShared := transferReq(shared, private, 300, "2026-04-03")
	fromShared.Comment = "из общего"
	e.createTx(t, member, fromShared)

	// Владелец личного счёта видит всё, колонка участника пуста.
	rows := e.exportTx(t, member, "")
	if len(rows) != 3 {
		t.Fatalf("у владельца счёта %d строк: %q", len(rows), rows)
	}
	for _, row := range rows {
		if m := rowMap(exportTxHeader, row); m["Личный счёт участника"] != "" {
			t.Errorf("у владельца счёта заполнен участник: %v", m)
		}
	}

	// Другой участник: личного расхода нет, у переводов личная сторона пустая.
	check := func(rows [][]string) {
		t.Helper()
		if len(rows) != 2 {
			t.Fatalf("у другого участника %d строк: %q", len(rows), rows)
		}
		wantRow(t, "снятие", rowMap(exportTxHeader, rows[0]), map[string]string{
			"Вид": "Перевод", "Счёт": "Общий", "Сумма": "3,00", "Валюта": "RUB",
			"Счёт зачисления": "", "Сумма зачисления": "", "Валюта зачисления": "",
			"Личный счёт участника": "Мария", "Комментарий": "из общего",
		})
		wantRow(t, "пополнение", rowMap(exportTxHeader, rows[1]), map[string]string{
			"Вид": "Перевод", "Счёт": "", "Сумма": "", "Валюта": "",
			"Счёт зачисления": "Общий", "Сумма зачисления": "5,00", "Валюта зачисления": "RUB",
			"Личный счёт участника": "Мария", "Комментарий": "в общий",
		})
	}
	check(e.exportTx(t, owner, ""))
	// Фильтр по id чужого личного счёта ничего не находит — как в ленте.
	if rows := e.exportTx(t, owner, "accountId="+private); len(rows) != 0 {
		t.Errorf("по чужому личному счёту: %q", rows)
	}

	files := e.exportAll(t, owner)
	check(parseExportCSV(t, files["transactions.csv"])[1:])
	for name, b := range files {
		if bytes.Contains(b, []byte("Тайный")) || bytes.Contains(b, []byte("секрет")) {
			t.Errorf("%s раскрывает чужой личный счёт: %s", name, b)
		}
	}
	accounts := parseExportCSV(t, files["accounts.csv"])
	if len(accounts) != 2 || accounts[1][0] != "Общий" {
		t.Errorf("accounts.csv другого участника: %q", accounts)
	}
	// У владельца личный счёт в списке есть, с остатком.
	accounts = parseExportCSV(t, e.exportAll(t, member)["accounts.csv"])
	if len(accounts) != 3 {
		t.Fatalf("accounts.csv владельца: %q", accounts)
	}
	wantRow(t, "личный счёт", rowMap(exportAccountsHeader, accounts[2]), map[string]string{
		"Название": "Тайный", "Видимость": "Личный", "Начальный остаток": "10,00", "Текущий остаток": "7,00",
	})
}

func TestExportFamilyIsolation(t *testing.T) {
	e := newAuthEnv(t, Options{})
	a := e.newUser(t)
	b := e.newUser(t)
	acc := e.createAccount(t, a, accountBody("Счёт A", "shared", 0))["id"].(string)
	r := expenseReq(acc, e.catID(t, a.familyID, "expense", "Продукты"), 100, "2026-04-01")
	r.Comment = "семья A"
	e.createTx(t, a, r)

	// Пустая выгрузка — BOM и одна строка заголовка.
	raw := e.exportTxRaw(t, b, "")
	if want := bom + strings.Join(exportTxHeader, ";") + "\r\n"; string(raw) != want {
		t.Errorf("пустая выгрузка: %q", raw)
	}
	// Фильтр по счёту чужой семьи тоже ничего не находит.
	if rows := e.exportTx(t, b, "accountId="+acc); len(rows) != 0 {
		t.Errorf("по чужому счёту: %q", rows)
	}
	files := e.exportAll(t, b)
	if rows := parseExportCSV(t, files["transactions.csv"]); len(rows) != 1 {
		t.Errorf("transactions.csv чужой семьи: %q", rows)
	}
	if rows := parseExportCSV(t, files["accounts.csv"]); len(rows) != 1 {
		t.Errorf("accounts.csv чужой семьи: %q", rows)
	}
	for name, body := range files {
		if bytes.Contains(body, []byte("семья A")) || bytes.Contains(body, []byte("Счёт A")) {
			t.Errorf("%s раскрывает чужую семью", name)
		}
	}
}

// --- Полный экспорт ----------------------------------------------------------

func TestExportAll(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	main := e.createAccount(t, u, accountBody("Основной", "shared", 150))["id"].(string)
	old := e.createAccount(t, u, usdAccountBody("Старый", "private"))["id"].(string)
	if rec := e.as(u, http.MethodPut, "/accounts/"+old, `{"name":"Старый","type":"card","initialBalance":0,"includeInTotal":false,"color":null}`); rec.Code != http.StatusOK {
		t.Fatalf("правка счёта: %d %s", rec.Code, rec.Body)
	}
	if rec := e.as(u, http.MethodPost, "/accounts/"+old+"/archive", ""); rec.Code != http.StatusOK {
		t.Fatalf("архив счёта: %d %s", rec.Code, rec.Body)
	}
	hobby := e.catID(t, u.familyID, "expense", "Хобби")
	if rec := e.as(u, http.MethodPost, "/categories/"+hobby+"/archive", ""); rec.Code != http.StatusOK {
		t.Fatalf("архив категории: %d %s", rec.Code, rec.Body)
	}
	e.createTx(t, u, expenseReq(main, e.catID(t, u.familyID, "expense", "Продукты"), 50, "2026-05-01"))

	files := e.exportAll(t, u)

	accounts := parseExportCSV(t, files["accounts.csv"])
	if !slices.Equal(accounts[0], exportAccountsHeader) || len(accounts) != 3 {
		t.Fatalf("accounts.csv: %q", accounts)
	}
	wantRow(t, "основной", rowMap(exportAccountsHeader, accounts[1]), map[string]string{
		"Название": "Основной", "Тип": "Наличные", "Валюта": "RUB", "Видимость": "Общий",
		"Начальный остаток": "1,50", "Текущий остаток": "1,00", "В общем балансе": "Да", "В архиве": "Нет",
	})
	wantRow(t, "архивный", rowMap(exportAccountsHeader, accounts[2]), map[string]string{
		"Название": "Старый", "Тип": "Карта", "Валюта": "USD", "Видимость": "Личный",
		"Начальный остаток": "0,00", "Текущий остаток": "0,00", "В общем балансе": "Нет", "В архиве": "Да",
	})

	cats := parseExportCSV(t, files["categories.csv"])
	if !slices.Equal(cats[0], exportCategoriesHeader) {
		t.Fatalf("заголовок categories.csv: %q", cats[0])
	}
	// 17 + 12 подкатегорий расходов, 5 доходов (defaultcategories.go).
	if len(cats)-1 != 34 {
		t.Errorf("категорий %d, ожидалось 34", len(cats)-1)
	}
	joined := make([]string, 0, len(cats))
	for _, c := range cats[1:] {
		joined = append(joined, strings.Join(c, "|"))
	}
	for _, want := range []string{
		"Расход|Продукты||Нет",
		"Расход|Развлечения||Нет",
		"Расход|Развлечения|Кино и театр|Нет",
		"Расход|Развлечения|Хобби|Да",
		"Доход|Зарплата||Нет",
		"Доход|Подарки||Нет",
	} {
		if !slices.Contains(joined, want) {
			t.Errorf("в categories.csv нет %q", want)
		}
	}
	// Родитель идёт раньше подкатегорий, расходы — раньше доходов.
	if i, j := slices.Index(joined, "Расход|Развлечения||Нет"), slices.Index(joined, "Расход|Развлечения|Кино и театр|Нет"); i < 0 || j != i+1 {
		t.Errorf("подкатегория не сразу за родителем: %d, %d", i, j)
	}
	if !strings.HasPrefix(joined[0], "Расход|") || !strings.HasPrefix(joined[len(joined)-1], "Доход|") {
		t.Errorf("порядок видов: %q … %q", joined[0], joined[len(joined)-1])
	}

	// transactions.csv — тот же файл, что /export/transactions без фильтров.
	if want := e.exportTxRaw(t, u, ""); !bytes.Equal(files["transactions.csv"], want) {
		t.Errorf("transactions.csv отличается от /export/transactions:\n%q\n%q", files["transactions.csv"], want)
	}
}

func TestExportAllRateLimit(t *testing.T) {
	e := newAuthEnv(t, Options{Limits: Limits{ExportAllPerUser: ratelimit.Rule{Limit: 2, Window: time.Hour}}})
	u := e.newUser(t)
	other := e.newUser(t)
	e.exportAll(t, u)
	e.exportAll(t, u)
	rec := e.as(u, http.MethodGet, "/export/all", "")
	decodeProblem(t, rec, http.StatusTooManyRequests, "too_many_requests")
	if ra, err := strconv.Atoi(rec.Header().Get("Retry-After")); err != nil || ra <= 0 {
		t.Errorf("Retry-After = %q", rec.Header().Get("Retry-After"))
	}
	// Лимит — на пользователя, не общий.
	e.exportAll(t, other)
	// Выгрузка операций лимитом полного экспорта не ограничена.
	e.exportTx(t, u, "")
	// Окно прошло — снова можно.
	e.clock.Advance(time.Hour + time.Second)
	e.exportAll(t, u)
}

// TestExportHeadRequest — HEAD (его middleware.GetHead обслуживает как GET)
// отдаёт заголовки без тела.
func TestExportHeadRequest(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	req := httptest.NewRequest(http.MethodHead, "/api/v1/export/transactions", nil)
	req.AddCookie(u.cookie)
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "text/csv; charset=utf-8" {
		t.Fatalf("HEAD: %d %v", rec.Code, rec.Header())
	}
}

// TestStreamAbortedPanics — ошибка посреди файла не превращается в Problem
// JSON (он дописался бы в конец CSV), а обрывает соединение.
func TestStreamAbortedPanics(t *testing.T) {
	h := responseErrorHandler(discardLogger)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/export/all", nil)
	defer func() {
		if r := recover(); r != http.ErrAbortHandler {
			t.Fatalf("recover() = %v, ожидалась http.ErrAbortHandler", r)
		}
		if rec.Body.Len() != 0 {
			t.Fatalf("в ответ дописано: %s", rec.Body)
		}
	}()
	h(rec, req, &errStreamAborted{io.ErrUnexpectedEOF})
}
