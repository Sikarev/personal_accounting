package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"slices"
	"strconv"
	"testing"
	"time"
)

// --- Помощники ---------------------------------------------------------------

// txReq — тело создания/правки операции. Пустые поля в JSON не попадают.
type txReq struct {
	Kind        string `json:"kind"`
	Date        string `json:"date"`
	AccountID   string `json:"accountId"`
	Amount      int64  `json:"amount"`
	CategoryID  string `json:"categoryId,omitempty"`
	ToAccountID string `json:"toAccountId,omitempty"`
	ToAmount    int64  `json:"toAmount,omitempty"`
	Comment     string `json:"comment,omitempty"`
}

func (r txReq) json() string {
	b, _ := json.Marshal(r)
	return string(b)
}

func expenseReq(account, category string, amount int64, date string) txReq {
	return txReq{Kind: "expense", Date: date, AccountID: account, Amount: amount, CategoryID: category}
}

func incomeReq(account, category string, amount int64, date string) txReq {
	return txReq{Kind: "income", Date: date, AccountID: account, Amount: amount, CategoryID: category}
}

func transferReq(from, to string, amount int64, date string) txReq {
	return txReq{Kind: "transfer", Date: date, AccountID: from, ToAccountID: to, Amount: amount}
}

// createTx создаёт операцию и возвращает её (сырой JSON).
func (e authEnv) createTx(t *testing.T, u accUser, r txReq) map[string]any {
	t.Helper()
	rec := e.as(u, http.MethodPost, "/transactions", r.json())
	if rec.Code != http.StatusCreated {
		t.Fatalf("создание операции %s: %d %s", r.json(), rec.Code, rec.Body)
	}
	return decodeJSON(t, rec)
}

func (e authEnv) createTxID(t *testing.T, u accUser, r txReq) string {
	t.Helper()
	return e.createTx(t, u, r)["id"].(string)
}

// catID — id категории семьи по виду и имени (верхнего уровня или подкатегории).
func (e authEnv) catID(t *testing.T, familyID, kind, name string) string {
	t.Helper()
	var id string
	if err := e.pool.QueryRow(context.Background(),
		`SELECT id FROM categories WHERE family_id = $1 AND kind = $2 AND name = $3`,
		familyID, kind, name).Scan(&id); err != nil {
		t.Fatalf("категория %s/%s: %v", kind, name, err)
	}
	return id
}

func usdAccountBody(name, visibility string) string {
	return `{"name":` + strconv.Quote(name) + `,"type":"card","currency":"USD","visibility":"` + visibility + `"}`
}

type currencyTotal struct {
	Currency string `json:"currency"`
	Expense  int64  `json:"expense"`
	Income   int64  `json:"income"`
}

type feedDay struct {
	Date   string          `json:"date"`
	Totals []currencyTotal `json:"totals"`
}

type feedPage struct {
	Items      []map[string]any `json:"items"`
	NextCursor *string          `json:"nextCursor"`
	Days       []feedDay        `json:"days"`
}

// feed — одна страница ленты; query — параметры без «?».
func (e authEnv) feed(t *testing.T, u accUser, query string) feedPage {
	t.Helper()
	rec := e.as(u, http.MethodGet, "/transactions?"+query, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("лента ?%s: %d %s", query, rec.Code, rec.Body)
	}
	var p feedPage
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if p.Items == nil || p.Days == nil {
		t.Fatalf("items или days — не массив: %s", rec.Body)
	}
	return p
}

// feedIDs — id всех операций ленты под фильтром (все страницы).
func (e authEnv) feedIDs(t *testing.T, u accUser, query string) []string {
	t.Helper()
	var out []string
	q := query
	for range 100 {
		p := e.feed(t, u, q)
		out = append(out, ids(p.Items)...)
		if p.NextCursor == nil {
			return out
		}
		q = query + "&cursor=" + url.QueryEscape(*p.NextCursor)
	}
	t.Fatal("лента не кончается")
	return nil
}

func (e authEnv) summary(t *testing.T, u accUser, query string) []currencyTotal {
	t.Helper()
	rec := e.as(u, http.MethodGet, "/transactions/summary?"+query, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("итоги ?%s: %d %s", query, rec.Code, rec.Body)
	}
	var body struct {
		Totals []currencyTotal `json:"totals"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Totals == nil {
		t.Fatalf("totals — не массив: %s", rec.Body)
	}
	return body.Totals
}

// auditEntry — запись журнала изменений по операции.
type auditEntry struct {
	actor, action string
	before, after map[string]any
}

func (e authEnv) auditOf(t *testing.T, familyID, txID string) []auditEntry {
	t.Helper()
	rows, err := e.pool.Query(context.Background(), `
		SELECT actor_user_id::text, action::text, before, after FROM audit_log
		WHERE family_id = $1 AND entity_type = 'transaction' AND entity_id = $2
		ORDER BY id`, familyID, txID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []auditEntry
	for rows.Next() {
		var a auditEntry
		if err := rows.Scan(&a.actor, &a.action, &a.before, &a.after); err != nil {
			t.Fatal(err)
		}
		out = append(out, a)
	}
	return out
}

func sortedStrings(s []string) []string {
	s = slices.Clone(s)
	slices.Sort(s)
	return s
}

func wantSameIDs(t *testing.T, what string, got, want []string) {
	t.Helper()
	if !reflect.DeepEqual(sortedStrings(got), sortedStrings(want)) {
		t.Fatalf("%s: %v, ожидалось %v", what, got, want)
	}
}

func wantFieldErr(t *testing.T, rec *httptest.ResponseRecorder, want ...string) {
	t.Helper()
	body := decodeProblem(t, rec, http.StatusUnprocessableEntity, "validation_failed")
	if got := fieldErrors(t, body); !reflect.DeepEqual(sortedStrings(got), sortedStrings(want)) {
		t.Fatalf("ошибки полей: %v, ожидалось %v", got, want)
	}
}

const (
	day1 = "2026-11-10"
	day2 = "2026-11-11"
	day3 = "2026-11-12"
)

// --- Создание, чтение ---------------------------------------------------------

func TestCreateTransactionKinds(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	cash := e.createAccount(t, u, accountBody("Наличные", "shared", 100000))["id"].(string)
	card := e.createAccount(t, u, accountBody("Карта", "private", 0))["id"].(string)
	usd := e.createAccount(t, u, usdAccountBody("Доллары", "shared"))["id"].(string)
	products := e.catID(t, u.familyID, "expense", "Продукты")
	salary := e.catID(t, u.familyID, "income", "Зарплата")

	// Расход: сырой JSON целиком — имена полей и отсутствие лишних.
	r := expenseReq(cash, products, 35050, day1)
	r.Comment = "  хлеб и молоко  "
	got := e.createTx(t, u, r)
	id := got["id"].(string)
	want := map[string]any{
		"id": id, "kind": "expense", "date": day1,
		"accountId": cash, "amount": float64(35050), "currency": "RUB",
		"toAccountId": nil, "toAmount": nil, "toCurrency": nil,
		"categoryId": products, "comment": "хлеб и молоко",
		"author":       map[string]any{"id": u.id, "name": "Иван"},
		"counterparty": nil, "editable": true,
		"createdAt": got["createdAt"], "updatedAt": got["updatedAt"],
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("расход:\n%v\nожидалось\n%v", got, want)
	}
	if rec := e.as(u, http.MethodGet, "/transactions/"+id, ""); rec.Code != http.StatusOK || !reflect.DeepEqual(decodeJSON(t, rec), want) {
		t.Fatalf("GET расхода: %d %s", rec.Code, rec.Body)
	}

	// Доход.
	inc := e.createTx(t, u, incomeReq(card, salary, 500000, day2))
	if inc["kind"] != "income" || inc["amount"] != float64(500000) || inc["categoryId"] != salary {
		t.Fatalf("доход: %v", inc)
	}

	// Перевод в одной валюте: toAmount не передан — равен amount.
	tr := e.createTx(t, u, transferReq(card, cash, 20000, day2))
	if tr["toAccountId"] != cash || tr["toAmount"] != float64(20000) || tr["toCurrency"] != "RUB" ||
		tr["categoryId"] != nil || tr["currency"] != "RUB" {
		t.Fatalf("перевод: %v", tr)
	}
	// toAmount = amount тоже можно передать явно.
	r = transferReq(card, cash, 100, day2)
	r.ToAmount = 100
	e.createTx(t, u, r)

	// Обмен валют: обе суммы.
	r = transferReq(cash, usd, 92000, day3)
	r.ToAmount = 1000
	ex := e.createTx(t, u, r)
	if ex["amount"] != float64(92000) || ex["currency"] != "RUB" || ex["toAmount"] != float64(1000) || ex["toCurrency"] != "USD" {
		t.Fatalf("обмен: %v", ex)
	}

	// Остатки: знаки расставлены сервером.
	for acc, want := range map[string]int64{
		cash: 100000 - 35050 + 20000 + 100 - 92000,
		card: 500000 - 20000 - 100,
		usd:  1000,
	} {
		if got := e.balanceOf(t, u, acc); got != want {
			t.Fatalf("остаток %s: %d, ожидался %d", acc, got, want)
		}
	}

	// Журнал: запись create на каждую операцию, снимок в формате API.
	a := e.auditOf(t, u.familyID, ex["id"].(string))
	if len(a) != 1 || a[0].action != "create" || a[0].actor != u.id || a[0].before != nil {
		t.Fatalf("журнал обмена: %+v", a)
	}
	wantSnap := map[string]any{
		"id": ex["id"], "kind": "transfer", "date": day3,
		"accountId": cash, "amount": float64(92000), "currency": "RUB",
		"toAccountId": usd, "toAmount": float64(1000), "toCurrency": "USD",
		"categoryId": nil, "comment": "", "authorId": u.id,
		"createdAt": ex["createdAt"], "updatedAt": ex["updatedAt"],
	}
	if !reflect.DeepEqual(a[0].after, wantSnap) {
		t.Fatalf("снимок:\n%v\nожидалось\n%v", a[0].after, wantSnap)
	}
}

func TestTransactionValidation(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	member := e.addMember(t, u)
	stranger := e.newUser(t)

	cash := e.createAccount(t, u, accountBody("Наличные", "shared", 0))["id"].(string)
	card := e.createAccount(t, u, accountBody("Карта", "shared", 0))["id"].(string)
	usd := e.createAccount(t, u, usdAccountBody("Доллары", "shared"))["id"].(string)
	archived := e.createAccount(t, u, accountBody("Старый", "shared", 0))["id"].(string)
	memberPrivate := e.createAccount(t, member, accountBody("Мой", "private", 0))["id"].(string)
	foreign := e.createAccount(t, stranger, accountBody("Чужой", "shared", 0))["id"].(string)
	const missing = "0193b7c2-1f7e-7c4e-9a51-3c2d1e0f9a8b"

	products := e.catID(t, u.familyID, "expense", "Продукты")
	salary := e.catID(t, u.familyID, "income", "Зарплата")
	hobby := e.catID(t, u.familyID, "expense", "Хобби")
	foreignCat := e.catID(t, stranger.familyID, "expense", "Продукты")

	// Операция на счёте и в категории, которые потом уйдут в архив.
	oldID := e.createTxID(t, u, expenseReq(archived, hobby, 100, day1))
	// Обычная операция: на ней проверяются ошибки правки.
	other := e.createTxID(t, u, expenseReq(cash, products, 1, day1))
	if rec := e.as(u, http.MethodPost, "/accounts/"+archived+"/archive", ""); rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}
	if rec := e.as(u, http.MethodPost, "/categories/"+hobby+"/archive", ""); rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}

	cases := []struct {
		name string
		body string
		want []string
	}{
		{"расход без категории", txReq{Kind: "expense", Date: day1, AccountID: cash, Amount: 1}.json(), []string{"categoryId:required"}},
		{"расход со счётом зачисления", txReq{Kind: "expense", Date: day1, AccountID: cash, Amount: 1, CategoryID: products, ToAccountID: card, ToAmount: 1}.json(),
			[]string{"toAccountId:not_allowed", "toAmount:not_allowed"}},
		{"перевод с категорией", txReq{Kind: "transfer", Date: day1, AccountID: cash, ToAccountID: card, Amount: 1, CategoryID: products}.json(), []string{"categoryId:not_allowed"}},
		{"перевод без получателя", txReq{Kind: "transfer", Date: day1, AccountID: cash, Amount: 1}.json(), []string{"toAccountId:required"}},
		{"перевод на тот же счёт", transferReq(cash, cash, 1, day1).json(), []string{"toAccountId:same_account"}},
		{"перевод в одной валюте с другой суммой", txReq{Kind: "transfer", Date: day1, AccountID: cash, ToAccountID: card, Amount: 100, ToAmount: 99}.json(), []string{"toAmount:to_amount_mismatch"}},
		{"обмен без суммы зачисления", transferReq(cash, usd, 100, day1).json(), []string{"toAmount:required"}},
		{"счёт чужой семьи", expenseReq(foreign, products, 1, day1).json(), []string{"accountId:invalid_account"}},
		{"несуществующий счёт", expenseReq(missing, products, 1, day1).json(), []string{"accountId:invalid_account"}},
		{"чужой личный счёт", expenseReq(memberPrivate, products, 1, day1).json(), []string{"accountId:invalid_account"}},
		{"архивный счёт", expenseReq(archived, products, 1, day1).json(), []string{"accountId:invalid_account"}},
		{"перевод на чужой личный", transferReq(cash, memberPrivate, 1, day1).json(), []string{"toAccountId:invalid_account"}},
		{"категория другого вида", expenseReq(cash, salary, 1, day1).json(), []string{"categoryId:invalid_category"}},
		{"архивная категория", expenseReq(cash, hobby, 1, day1).json(), []string{"categoryId:invalid_category"}},
		{"категория чужой семьи", expenseReq(cash, foreignCat, 1, day1).json(), []string{"categoryId:invalid_category"}},
		{"несуществующая категория", expenseReq(cash, missing, 1, day1).json(), []string{"categoryId:invalid_category"}},
		{"несуществующая дата", expenseReq(cash, products, 1, "2026-02-31").json(), []string{"date:invalid_format"}},
		{"год 0", expenseReq(cash, products, 1, "0000-01-01").json(), []string{"date:invalid_format"}},
		{"нулевая сумма", expenseReq(cash, products, 0, day1).json(), []string{"amount:too_small"}},
		{"сумма больше 10^13", expenseReq(cash, products, 10_000_000_000_001, day1).json(), []string{"amount:too_large"}},
		{"управляющий символ в комментарии", txReq{Kind: "expense", Date: day1, AccountID: cash, Amount: 1, CategoryID: products, Comment: "a\x00b"}.json(), []string{"comment:invalid_format"}},
		{"корректировку не создать", txReq{Kind: "adjustment", Date: day1, AccountID: cash, Amount: 1}.json(), []string{"kind:invalid_value"}},
		{"лишнее поле", `{"kind":"expense","date":"` + day1 + `","accountId":"` + cash + `","amount":1,"categoryId":"` + products + `","currency":"USD"}`, []string{"currency:unknown_field"}},
	}
	before := queryInt(t, e.pool, `SELECT count(*) FROM transactions WHERE family_id = $1`, u.familyID)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			wantFieldErr(t, e.as(u, http.MethodPost, "/transactions", tc.body), tc.want...)
			// Те же правила при правке.
			wantFieldErr(t, e.as(u, http.MethodPut, "/transactions/"+other, tc.body), tc.want...)
		})
	}
	if n := queryInt(t, e.pool, `SELECT count(*) FROM transactions WHERE family_id = $1`, u.familyID); n != before {
		t.Fatalf("при ошибках создались операции: %d → %d", before, n)
	}

	// Перевод в одной валюте c 10^13 и комментарий ровно 500 символов — можно.
	r := transferReq(cash, card, 10_000_000_000_000, day1)
	r.Comment = longName(500)
	e.createTx(t, u, r)
	r.Comment = longName(501)
	wantFieldErr(t, e.as(u, http.MethodPost, "/transactions", r.json()), "comment:too_long")

	// Правка старой операции: архивные счёт и категория не менялись — можно.
	upd := expenseReq(archived, hobby, 250, day2)
	rec := e.as(u, http.MethodPut, "/transactions/"+oldID, upd.json())
	if rec.Code != http.StatusOK {
		t.Fatalf("правка операции на архивном счёте: %d %s", rec.Code, rec.Body)
	}
	if got := decodeJSON(t, rec); got["amount"] != float64(250) || got["date"] != day2 {
		t.Fatalf("после правки: %v", got)
	}
	// Перенос на архивный счёт другой операции — нельзя.
	wantFieldErr(t, e.as(u, http.MethodPut, "/transactions/"+other, expenseReq(archived, products, 1, day1).json()), "accountId:invalid_account")
	wantFieldErr(t, e.as(u, http.MethodPut, "/transactions/"+other, expenseReq(cash, hobby, 1, day1).json()), "categoryId:invalid_category")
}

// --- Правка, удаление, восстановление -----------------------------------------

func TestUpdateTransactionChangesKindAndAccount(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	cash := e.createAccount(t, u, accountBody("Наличные", "shared", 0))["id"].(string)
	card := e.createAccount(t, u, accountBody("Карта", "shared", 0))["id"].(string)
	usd := e.createAccount(t, u, usdAccountBody("Доллары", "shared"))["id"].(string)
	products := e.catID(t, u.familyID, "expense", "Продукты")
	salary := e.catID(t, u.familyID, "income", "Зарплата")

	id := e.createTxID(t, u, expenseReq(cash, products, 1000, day1))
	put := func(r txReq) map[string]any {
		t.Helper()
		e.clock.Advance(time.Second)
		rec := e.as(u, http.MethodPut, "/transactions/"+id, r.json())
		if rec.Code != http.StatusOK {
			t.Fatalf("правка %s: %d %s", r.json(), rec.Code, rec.Body)
		}
		return decodeJSON(t, rec)
	}
	balances := func(want map[string]int64) {
		t.Helper()
		for acc, w := range want {
			if got := e.balanceOf(t, u, acc); got != w {
				t.Fatalf("остаток %s: %d, ожидался %d", acc, got, w)
			}
		}
	}

	// Расход → доход на другом счёте.
	got := put(incomeReq(card, salary, 2000, day2))
	if got["kind"] != "income" || got["accountId"] != card || got["categoryId"] != salary || got["date"] != day2 {
		t.Fatalf("доход: %v", got)
	}
	balances(map[string]int64{cash: 0, card: 2000})

	// Доход → обмен валют (счёт в другой валюте).
	r := transferReq(cash, usd, 9200, day2)
	r.ToAmount = 100
	got = put(r)
	if got["kind"] != "transfer" || got["categoryId"] != nil || got["toAccountId"] != usd || got["toCurrency"] != "USD" {
		t.Fatalf("перевод: %v", got)
	}
	balances(map[string]int64{cash: -9200, card: 0, usd: 100})

	// Перевод → расход в долларах: валюта операции — валюта нового счёта.
	r = expenseReq(usd, products, 50, day3)
	r.Comment = "кофе"
	got = put(r)
	if got["currency"] != "USD" || got["toAccountId"] != nil || got["toAmount"] != nil || got["comment"] != "кофе" {
		t.Fatalf("расход в долларах: %v", got)
	}
	balances(map[string]int64{cash: 0, usd: -50})
	if got["createdAt"] == got["updatedAt"] {
		t.Fatalf("updatedAt не изменился: %v", got)
	}

	// Журнал: create + 3 update, у каждого update снимки до и после.
	a := e.auditOf(t, u.familyID, id)
	if len(a) != 4 || a[0].action != "create" {
		t.Fatalf("журнал: %+v", a)
	}
	for i, entry := range a[1:] {
		if entry.action != "update" || entry.before == nil || entry.after == nil {
			t.Fatalf("запись %d: %+v", i+1, entry)
		}
		if !reflect.DeepEqual(entry.before, a[i].after) {
			t.Fatalf("before записи %d не совпадает с after предыдущей:\n%v\n%v", i+1, entry.before, a[i].after)
		}
	}
	last := a[3].after
	if last["kind"] != "expense" || last["accountId"] != usd || last["currency"] != "USD" ||
		last["amount"] != float64(50) || last["comment"] != "кофе" || last["date"] != day3 {
		t.Fatalf("последний снимок: %v", last)
	}
	if a[2].after["kind"] != "transfer" || a[2].after["toAmount"] != float64(100) || a[2].after["amount"] != float64(9200) {
		t.Fatalf("снимок перевода: %v", a[2].after)
	}
}

func TestDeleteAndRestoreTransaction(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	cash := e.createAccount(t, u, accountBody("Наличные", "shared", 1000))["id"].(string)
	products := e.catID(t, u.familyID, "expense", "Продукты")
	id := e.createTxID(t, u, expenseReq(cash, products, 300, day1))

	if rec := e.as(u, http.MethodDelete, "/transactions/"+id, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("удаление: %d %s", rec.Code, rec.Body)
	}
	if got := e.balanceOf(t, u, cash); got != 1000 {
		t.Fatalf("остаток после удаления: %d", got)
	}
	if ids := e.feedIDs(t, u, ""); len(ids) != 0 {
		t.Fatalf("удалённая в ленте: %v", ids)
	}
	if tot := e.summary(t, u, ""); len(tot) != 0 {
		t.Fatalf("удалённая в итогах: %v", tot)
	}
	// Удалённая — 404 везде, кроме restore.
	for _, op := range []struct{ method, path, body string }{
		{http.MethodGet, "/transactions/" + id, ""},
		{http.MethodPut, "/transactions/" + id, expenseReq(cash, products, 1, day1).json()},
		{http.MethodDelete, "/transactions/" + id, ""},
	} {
		decodeProblem(t, e.as(u, op.method, op.path, op.body), http.StatusNotFound, "not_found")
	}

	restore := func() map[string]any {
		t.Helper()
		rec := e.as(u, http.MethodPost, "/transactions/"+id+"/restore", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("восстановление: %d %s", rec.Code, rec.Body)
		}
		return decodeJSON(t, rec)
	}
	if got := restore(); got["id"] != id || got["amount"] != float64(300) {
		t.Fatalf("восстановленная: %v", got)
	}
	if got := e.balanceOf(t, u, cash); got != 700 {
		t.Fatalf("остаток после восстановления: %d", got)
	}
	restore() // идемпотентно

	a := e.auditOf(t, u.familyID, id)
	actions := make([]string, 0, len(a))
	for _, entry := range a {
		actions = append(actions, entry.action)
	}
	if !reflect.DeepEqual(actions, []string{"create", "delete", "restore"}) {
		t.Fatalf("журнал: %v", actions)
	}
	if a[1].before["id"] != id || a[1].after != nil || a[2].before != nil || a[2].after["id"] != id {
		t.Fatalf("снимки удаления и восстановления: %+v", a[1:])
	}

	// Несуществующая операция.
	const missing = "0193b7c2-1f7e-7c4e-9a51-3c2d1e0f9a8b"
	decodeProblem(t, e.as(u, http.MethodPost, "/transactions/"+missing+"/restore", ""), http.StatusNotFound, "not_found")
}

func TestAdjustmentTransaction(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	cash := e.createAccount(t, u, accountBody("Наличные", "shared", 1000))["id"].(string)
	products := e.catID(t, u.familyID, "expense", "Продукты")

	rec := e.as(u, http.MethodPost, "/accounts/"+cash+"/adjust-balance", `{"balance":400}`)
	if rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}
	id := decodeJSON(t, rec)["transactionId"].(string)

	// В ленте: amount со знаком, editable = false; в итоги не входит.
	p := e.feed(t, u, "")
	if len(p.Items) != 1 || p.Items[0]["kind"] != "adjustment" || p.Items[0]["amount"] != float64(-600) ||
		p.Items[0]["editable"] != false || p.Items[0]["categoryId"] != nil {
		t.Fatalf("корректировка в ленте: %v", p.Items)
	}
	if len(p.Days) != 1 || len(p.Days[0].Totals) != 0 {
		t.Fatalf("итоги дня с корректировкой: %+v", p.Days)
	}

	// Править нельзя, удалить и вернуть — можно.
	decodeProblem(t, e.as(u, http.MethodPut, "/transactions/"+id, expenseReq(cash, products, 1, day1).json()),
		http.StatusConflict, "adjustment_readonly")
	if rec := e.as(u, http.MethodDelete, "/transactions/"+id, ""); rec.Code != http.StatusNoContent {
		t.Fatal(rec.Body)
	}
	if got := e.balanceOf(t, u, cash); got != 1000 {
		t.Fatalf("остаток после удаления корректировки: %d", got)
	}
	if rec := e.as(u, http.MethodPost, "/transactions/"+id+"/restore", ""); rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}
	if got := e.balanceOf(t, u, cash); got != 400 {
		t.Fatalf("остаток после восстановления корректировки: %d", got)
	}
	a := e.auditOf(t, u.familyID, id)
	if len(a) != 3 || a[1].action != "delete" || a[1].before["amount"] != float64(-600) || a[2].action != "restore" {
		t.Fatalf("журнал корректировки: %+v", a)
	}
}

// --- Лента, фильтры, итоги ------------------------------------------------------

func TestTransactionFilters(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	member := e.addMember(t, u)
	cash := e.createAccount(t, u, accountBody("Наличные", "shared", 0))["id"].(string)
	card := e.createAccount(t, u, accountBody("Карта", "shared", 0))["id"].(string)
	usd := e.createAccount(t, u, usdAccountBody("Доллары", "shared"))["id"].(string)
	products := e.catID(t, u.familyID, "expense", "Продукты")
	transport := e.catID(t, u.familyID, "expense", "Транспорт")
	taxi := e.catID(t, u.familyID, "expense", "Такси")
	salary := e.catID(t, u.familyID, "income", "Зарплата")

	withComment := func(r txReq, c string) txReq { r.Comment = c; return r }
	exProducts := e.createTxID(t, u, withComment(expenseReq(cash, products, 100, day1), "Ёлочные игрушки"))
	exTaxi := e.createTxID(t, u, withComment(expenseReq(card, taxi, 200, day2), "такси 100% домой"))
	exTransport := e.createTxID(t, u, expenseReq(cash, transport, 300, day3))
	inSalary := e.createTxID(t, member, withComment(incomeReq(card, salary, 5000, day2), "аванс_ноябрь"))
	trCashCard := e.createTxID(t, u, transferReq(cash, card, 50, day3))
	exUSD := e.createTxID(t, member, expenseReq(usd, products, 7, day1))
	all := []string{exProducts, exTaxi, exTransport, inSalary, trCashCard, exUSD}

	cases := []struct {
		name, query string
		want        []string
	}{
		{"без фильтров", "", all},
		{"период", "from=" + day2 + "&to=" + day2, []string{exTaxi, inSalary}},
		{"с даты", "from=" + day3, []string{exTransport, trCashCard}},
		{"по дату", "to=" + day1, []string{exProducts, exUSD}},
		{"вид", "kind=income", []string{inSalary}},
		{"несколько видов", "kind=income&kind=transfer", []string{inSalary, trCashCard}},
		{"счёт (перевод — по получателю)", "accountId=" + card, []string{exTaxi, inSalary, trCashCard}},
		{"несколько счетов", "accountId=" + usd + "&accountId=" + card, []string{exTaxi, inSalary, trCashCard, exUSD}},
		{"категория верхнего уровня с подкатегориями", "categoryId=" + transport, []string{exTaxi, exTransport}},
		{"подкатегория", "categoryId=" + taxi, []string{exTaxi}},
		{"несколько категорий", "categoryId=" + taxi + "&categoryId=" + salary, []string{exTaxi, inSalary}},
		{"автор", "authorId=" + member.id, []string{inSalary, exUSD}},
		{"поиск без регистра и с ё = е", "q=" + url.QueryEscape("ЕЛОЧН"), []string{exProducts}},
		{"поиск: % — обычный символ", "q=" + url.QueryEscape("0%"), []string{exTaxi}},
		{"поиск: _ — обычный символ", "q=" + url.QueryEscape("с_н"), []string{inSalary}},
		{"поиск: _ не подстановка", "q=" + url.QueryEscape("с_о"), nil},
		{"поиск из пробелов — без фильтра", "q=" + url.QueryEscape("  "), all},
		{"сочетание", "kind=expense&accountId=" + cash + "&from=" + day2, []string{exTransport}},
		{"сочетание: категория и автор", "categoryId=" + products + "&authorId=" + member.id, []string{exUSD}},
		{"несуществующий счёт", "accountId=0193b7c2-1f7e-7c4e-9a51-3c2d1e0f9a8b", nil},
		{"несуществующий автор", "authorId=0193b7c2-1f7e-7c4e-9a51-3c2d1e0f9a8b", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			wantSameIDs(t, "лента", e.feedIDs(t, u, tc.query), tc.want)
		})
	}

	// Итоги: по валютам, только расходы и доходы.
	wantTotals := func(query string, want []currencyTotal) {
		t.Helper()
		got := e.summary(t, u, query)
		if want == nil {
			want = []currencyTotal{}
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("итоги ?%s: %+v, ожидалось %+v", query, got, want)
		}
	}
	wantTotals("", []currencyTotal{{"RUB", 600, 5000}, {"USD", 7, 0}})
	wantTotals("kind=transfer", nil)
	wantTotals("accountId="+card, []currencyTotal{{"RUB", 200, 5000}})
	wantTotals("categoryId="+transport+"&from="+day3, []currencyTotal{{"RUB", 300, 0}})
	wantTotals("q="+url.QueryEscape("ёлочные"), []currencyTotal{{"RUB", 100, 0}})

	// Порядок ленты: дата ↓, затем момент создания ↓.
	p := e.feed(t, u, "")
	wantOrder := []string{trCashCard, exTransport, inSalary, exTaxi, exUSD, exProducts}
	if got := ids(p.Items); !reflect.DeepEqual(got, wantOrder) {
		t.Fatalf("порядок: %v, ожидался %v", got, wantOrder)
	}
	wantDays := []feedDay{
		{day3, []currencyTotal{{"RUB", 300, 0}}},
		{day2, []currencyTotal{{"RUB", 200, 5000}}},
		{day1, []currencyTotal{{"RUB", 100, 0}, {"USD", 7, 0}}},
	}
	if !reflect.DeepEqual(p.Days, wantDays) {
		t.Fatalf("итоги дней: %+v, ожидалось %+v", p.Days, wantDays)
	}

	// Ошибки параметров.
	for _, tc := range []struct{ query, want string }{
		{"cursor=" + url.QueryEscape("не курсор"), "cursor:invalid_format"},
		{"cursor=" + url.QueryEscape("MjAyNi0wMi0zMXx4"), "cursor:invalid_format"}, // «2026-02-31|x»
		{"from=2026-02-31", "from:invalid_format"},
		{"limit=0", "limit:too_small"},
		{"limit=201", "limit:too_large"},
		{"kind=other", "kind.0:invalid_value"},
		{"accountId=1", "accountId:invalid_format"},
	} {
		wantFieldErr(t, e.as(u, http.MethodGet, "/transactions?"+tc.query, ""), tc.want)
	}
}

func TestTransactionFeedPagination(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	cash := e.createAccount(t, u, accountBody("Наличные", "shared", 0))["id"].(string)
	card := e.createAccount(t, u, accountBody("Карта", "shared", 0))["id"].(string)
	products := e.catID(t, u.familyID, "expense", "Продукты")
	salary := e.catID(t, u.familyID, "income", "Зарплата")

	// Много операций одной даты: курсор должен различать их по id.
	var want []string
	var dayExpense, dayIncome int64
	for i := range 23 {
		var id string
		switch i % 3 {
		case 0:
			id = e.createTxID(t, u, expenseReq(cash, products, int64(100+i), day2))
			dayExpense += int64(100 + i)
		case 1:
			id = e.createTxID(t, u, incomeReq(card, salary, int64(1000+i), day2))
			dayIncome += int64(1000 + i)
		default:
			id = e.createTxID(t, u, transferReq(cash, card, 5, day2))
		}
		want = append(want, id)
	}
	slices.Reverse(want) // новые сверху
	older := e.createTxID(t, u, expenseReq(cash, products, 1, day1))
	newer := e.createTxID(t, u, expenseReq(cash, products, 2, day3))
	want = append([]string{newer}, append(want, older)...)

	var got []string
	query := "limit=7"
	pages := 0
	for {
		p := e.feed(t, u, query)
		pages++
		if len(p.Items) > 7 {
			t.Fatalf("страница больше лимита: %d", len(p.Items))
		}
		got = append(got, ids(p.Items)...)
		// Итог дня 2 — по всем его операциям, даже на страницах, где их видна часть.
		for _, d := range p.Days {
			if d.Date == day2 && !reflect.DeepEqual(d.Totals, []currencyTotal{{"RUB", dayExpense, dayIncome}}) {
				t.Fatalf("итог дня на странице %d: %+v", pages, d.Totals)
			}
		}
		if p.NextCursor == nil {
			break
		}
		query = "limit=7&cursor=" + url.QueryEscape(*p.NextCursor)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("лента по страницам (%d стр.):\n%v\nожидалось\n%v", pages, got, want)
	}
	if pages != 4 { // 25 операций по 7
		t.Fatalf("страниц: %d", pages)
	}

	// Последняя страница ровно по лимиту: nextCursor нет, лишнего запроса не нужно.
	p := e.feed(t, u, "limit=25")
	if len(p.Items) != 25 || p.NextCursor != nil {
		t.Fatalf("ровно 25: %d, курсор %v", len(p.Items), p.NextCursor)
	}
	// Умолчание — 50.
	if p := e.feed(t, u, ""); len(p.Items) != 25 || p.NextCursor != nil {
		t.Fatalf("без limit: %d", len(p.Items))
	}

	// Операция, добавленная между страницами в уже пройденную часть, не
	// сдвигает следующие страницы (в отличие от offset).
	first := e.feed(t, u, "limit=5")
	e.createTxID(t, u, expenseReq(cash, products, 3, day3))
	second := e.feed(t, u, "limit=5&cursor="+url.QueryEscape(*first.NextCursor))
	if got := ids(second.Items); !reflect.DeepEqual(got, want[5:10]) {
		t.Fatalf("вторая страница после вставки: %v, ожидалось %v", got, want[5:10])
	}
}

func TestTransactionDefaults(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	member := e.addMember(t, u)

	defaults := func(who accUser) map[string]any {
		t.Helper()
		rec := e.as(who, http.MethodGet, "/transactions/defaults", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("defaults: %d %s", rec.Code, rec.Body)
		}
		return decodeJSON(t, rec)
	}
	empty := map[string]any{
		"expenseAccountId": nil, "incomeAccountId": nil, "transfer": nil,
		"frequentCategories": map[string]any{"expense": []any{}, "income": []any{}},
	}
	if got := defaults(u); !reflect.DeepEqual(got, empty) {
		t.Fatalf("без операций: %v", got)
	}

	cash := e.createAccount(t, u, accountBody("Наличные", "shared", 0))["id"].(string)
	card := e.createAccount(t, u, accountBody("Карта", "private", 0))["id"].(string)
	old := e.createAccount(t, u, accountBody("Старая", "shared", 0))["id"].(string)
	memberCard := e.createAccount(t, member, accountBody("Карта жены", "private", 0))["id"].(string)
	cat := func(kind, name string) string { return e.catID(t, u.familyID, kind, name) }

	today := dateIn(e.clock.Now(), time.FixedZone("MSK", 3*3600)).Format(time.DateOnly)
	ago := func(days int) string {
		d, _ := time.Parse(time.DateOnly, today)
		return d.AddDate(0, 0, -days).Format(time.DateOnly)
	}

	// Частота: Продукты ×3, Кафе ×2, Такси ×2 (Такси свежее по дате), Аптека ×1.
	e.createTxID(t, u, expenseReq(cash, cat("expense", "Продукты"), 1, ago(1)))
	e.createTxID(t, u, expenseReq(cash, cat("expense", "Продукты"), 1, ago(2)))
	e.createTxID(t, u, expenseReq(cash, cat("expense", "Продукты"), 1, ago(89))) // ещё в окне 90 дней
	e.createTxID(t, u, expenseReq(cash, cat("expense", "Кафе и рестораны"), 1, ago(5)))
	e.createTxID(t, u, expenseReq(cash, cat("expense", "Кафе и рестораны"), 1, ago(6)))
	e.createTxID(t, u, expenseReq(cash, cat("expense", "Такси"), 1, ago(3)))
	e.createTxID(t, u, expenseReq(cash, cat("expense", "Такси"), 1, ago(4)))
	e.createTxID(t, u, expenseReq(cash, cat("expense", "Аптека"), 1, ago(10)))
	// Вне окна, удалённая, в будущем, архивная категория — не считаются.
	for range 5 {
		e.createTxID(t, u, expenseReq(cash, cat("expense", "Подписки"), 1, ago(90)))
	}
	for range 5 {
		id := e.createTxID(t, u, expenseReq(cash, cat("expense", "Подарки"), 1, ago(1)))
		if rec := e.as(u, http.MethodDelete, "/transactions/"+id, ""); rec.Code != http.StatusNoContent {
			t.Fatal(rec.Body)
		}
	}
	for range 5 {
		e.createTxID(t, u, expenseReq(cash, cat("expense", "Дети"), 1, ago(-1)))
	}
	for range 5 {
		e.createTxID(t, u, expenseReq(cash, cat("expense", "Хобби"), 1, ago(1)))
	}
	if rec := e.as(u, http.MethodPost, "/categories/"+cat("expense", "Хобби")+"/archive", ""); rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}
	// Операции другого участника не считаются.
	for range 5 {
		e.createTxID(t, member, expenseReq(memberCard, cat("expense", "Образование"), 1, ago(1)))
	}

	// Последний расход — на карте, последний доход — на счёте, который уйдёт в архив.
	e.createTxID(t, u, expenseReq(card, cat("expense", "Продукты"), 1, ago(30))) // 4-й раз Продукты
	e.createTxID(t, u, incomeReq(cash, cat("income", "Зарплата"), 1, ago(1)))
	e.clock.Advance(time.Second) // при равной частоте и дате решает момент создания
	e.createTxID(t, u, incomeReq(old, cat("income", "Подработка"), 1, ago(1)))
	e.createTxID(t, u, transferReq(cash, card, 1, ago(1)))
	e.createTxID(t, u, transferReq(old, cash, 1, ago(1)))
	if rec := e.as(u, http.MethodPost, "/accounts/"+old+"/archive", ""); rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}

	got := defaults(u)
	want := map[string]any{
		"expenseAccountId": card,
		"incomeAccountId":  cash, // последний доход на архивном счёте пропущен
		"transfer":         map[string]any{"accountId": cash, "toAccountId": card},
		"frequentCategories": map[string]any{
			"expense": []any{
				cat("expense", "Продукты"), cat("expense", "Такси"),
				cat("expense", "Кафе и рестораны"), cat("expense", "Аптека"),
			},
			"income": []any{cat("income", "Подработка"), cat("income", "Зарплата")},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("defaults:\n%v\nожидалось\n%v", got, want)
	}

	// Не больше 8 категорий.
	for _, name := range []string{"Связь и интернет", "Одежда и обувь", "Дом и быт", "Красота и уход", "Путешествия"} {
		e.createTxID(t, u, expenseReq(cash, cat("expense", name), 1, today))
	}
	if n := len(defaults(u)["frequentCategories"].(map[string]any)["expense"].([]any)); n != 8 {
		t.Fatalf("частых категорий: %d", n)
	}

	// Чужой личный счёт не попадает в defaults, даже если пользователь
	// когда-то записал на него операцию (видимость могла смениться — этап 5).
	if _, err := e.pool.Exec(context.Background(), `
		INSERT INTO transactions (family_id, kind, account_id, amount, category_id, op_date, created_by)
		VALUES ($1, 'expense', $2, -1, $3, $4, $5)`,
		u.familyID, memberCard, cat("expense", "Образование"), today, u.id); err != nil {
		t.Fatal(err)
	}
	got = defaults(u)
	if got["expenseAccountId"] != cash || slices.Contains(got["frequentCategories"].(map[string]any)["expense"].([]any), any(cat("expense", "Образование"))) {
		t.Fatalf("defaults с чужим личным счётом: %v", got)
	}
	// А у участника — его счёт.
	if got := defaults(member); got["expenseAccountId"] != memberCard {
		t.Fatalf("defaults участника: %v", got)
	}
}

// --- Изоляция семей и видимость ---------------------------------------------------

func TestTransactionsFamilyIsolation(t *testing.T) {
	e := newAuthEnv(t, Options{})
	alice := e.newUser(t)
	bob := e.newUser(t)
	aliceCash := e.createAccount(t, alice, accountBody("Наличные", "shared", 0))["id"].(string)
	bobCash := e.createAccount(t, bob, accountBody("Наличные", "shared", 0))["id"].(string)
	aliceProducts := e.catID(t, alice.familyID, "expense", "Продукты")
	bobProducts := e.catID(t, bob.familyID, "expense", "Продукты")
	aliceTx := e.createTxID(t, alice, expenseReq(aliceCash, aliceProducts, 100, day1))
	e.createTxID(t, bob, expenseReq(bobCash, bobProducts, 200, day1))

	for _, op := range []struct{ method, path, body string }{
		{http.MethodGet, "/transactions/" + aliceTx, ""},
		{http.MethodPut, "/transactions/" + aliceTx, expenseReq(bobCash, bobProducts, 1, day1).json()},
		{http.MethodDelete, "/transactions/" + aliceTx, ""},
		{http.MethodPost, "/transactions/" + aliceTx + "/restore", ""},
	} {
		decodeProblem(t, e.as(bob, op.method, op.path, op.body), http.StatusNotFound, "not_found")
	}
	// Удалённая чужая — тоже 404 на restore.
	if rec := e.as(alice, http.MethodDelete, "/transactions/"+aliceTx, ""); rec.Code != http.StatusNoContent {
		t.Fatal(rec.Body)
	}
	decodeProblem(t, e.as(bob, http.MethodPost, "/transactions/"+aliceTx+"/restore", ""), http.StatusNotFound, "not_found")
	if rec := e.as(alice, http.MethodPost, "/transactions/"+aliceTx+"/restore", ""); rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}

	// Лента и итоги — только своя семья; фильтр по чужому id ничего не находит.
	if got := e.feedIDs(t, bob, ""); len(got) != 1 {
		t.Fatalf("лента Боба: %v", got)
	}
	for _, q := range []string{"accountId=" + aliceCash, "categoryId=" + aliceProducts, "authorId=" + alice.id} {
		if got := e.feedIDs(t, bob, q); len(got) != 0 {
			t.Fatalf("лента Боба ?%s: %v", q, got)
		}
		if got := e.summary(t, bob, q); len(got) != 0 {
			t.Fatalf("итоги Боба ?%s: %v", q, got)
		}
	}
	if got := e.summary(t, bob, ""); !reflect.DeepEqual(got, []currencyTotal{{"RUB", 200, 0}}) {
		t.Fatalf("итоги Боба: %v", got)
	}
	// Счёт и категория чужой семьи в теле — 422, как несуществующие.
	wantFieldErr(t, e.as(bob, http.MethodPost, "/transactions", expenseReq(aliceCash, bobProducts, 1, day1).json()), "accountId:invalid_account")
	wantFieldErr(t, e.as(bob, http.MethodPost, "/transactions", expenseReq(bobCash, aliceProducts, 1, day1).json()), "categoryId:invalid_category")
	// defaults Боба не знает о счетах Алисы.
	rec := e.as(bob, http.MethodGet, "/transactions/defaults", "")
	if d := decodeJSON(t, rec); d["expenseAccountId"] != bobCash {
		t.Fatalf("defaults Боба: %v", d)
	}
}

func TestTransactionPrivateAccountVisibility(t *testing.T) {
	e := newAuthEnv(t, Options{})
	owner := e.newUser(t)
	member := e.addMember(t, owner)
	shared := e.createAccount(t, owner, accountBody("Общий", "shared", 0))["id"].(string)
	private := e.createAccount(t, member, accountBody("Личный", "private", 0))["id"].(string)
	products := e.catID(t, owner.familyID, "expense", "Продукты")

	me := e.me(member.cookie)
	if fam := decodeJSON(t, me)["family"].(map[string]any); fam["memberCount"] != float64(2) {
		t.Fatalf("memberCount: %v", fam)
	}

	privExpense := e.createTxID(t, member, expenseReq(private, products, 100, day1))
	toShared := e.createTxID(t, member, transferReq(private, shared, 500, day2))   // «Пополнение от …»
	fromShared := e.createTxID(t, member, transferReq(shared, private, 300, day3)) // «Снятие …»

	// Владелец личного счёта видит всё целиком.
	wantSameIDs(t, "лента участника", e.feedIDs(t, member, ""), []string{privExpense, toShared, fromShared})
	for _, it := range e.feed(t, member, "").Items {
		if it["editable"] != true || it["counterparty"] != nil || it["accountId"] == nil {
			t.Fatalf("у владельца: %v", it)
		}
	}

	// Другой участник: расход на чужом личном счёте не виден нигде.
	wantSameIDs(t, "лента владельца", e.feedIDs(t, owner, ""), []string{toShared, fromShared})
	decodeProblem(t, e.as(owner, http.MethodGet, "/transactions/"+privExpense, ""), http.StatusNotFound, "not_found")
	for _, op := range []struct{ method, path, body string }{
		{http.MethodPut, "/transactions/" + privExpense, expenseReq(shared, products, 1, day1).json()},
		{http.MethodDelete, "/transactions/" + privExpense, ""},
		{http.MethodPost, "/transactions/" + privExpense + "/restore", ""},
	} {
		decodeProblem(t, e.as(owner, op.method, op.path, op.body), http.StatusNotFound, "not_found")
	}
	if got := e.summary(t, owner, ""); len(got) != 0 {
		t.Fatalf("итоги владельца включают чужой личный расход: %v", got)
	}
	p := e.feed(t, owner, "")
	for _, d := range p.Days {
		if len(d.Totals) != 0 {
			t.Fatalf("итоги дней владельца: %+v", p.Days)
		}
	}
	// Фильтр по чужому личному счёту ничего не находит — даже переводы с него.
	if got := e.feedIDs(t, owner, "accountId="+private); len(got) != 0 {
		t.Fatalf("фильтр по чужому личному счёту: %v", got)
	}
	if got := e.feedIDs(t, owner, "accountId="+shared); len(got) != 2 {
		t.Fatalf("фильтр по общему: %v", got)
	}

	// Перевод «личный → общий»: скрыта сторона списания.
	rec := e.as(owner, http.MethodGet, "/transactions/"+toShared, "")
	if rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}
	got := decodeJSON(t, rec)
	counterparty := map[string]any{"id": member.id, "name": "Иван"}
	if got["accountId"] != nil || got["amount"] != nil || got["currency"] != nil ||
		got["toAccountId"] != shared || got["toAmount"] != float64(500) || got["toCurrency"] != "RUB" ||
		!reflect.DeepEqual(got["counterparty"], counterparty) || got["editable"] != false {
		t.Fatalf("перевод личный → общий у владельца: %v", got)
	}
	// «Общий → личный»: скрыта сторона зачисления.
	got = decodeJSON(t, e.as(owner, http.MethodGet, "/transactions/"+fromShared, ""))
	if got["accountId"] != shared || got["amount"] != float64(300) ||
		got["toAccountId"] != nil || got["toAmount"] != nil || got["toCurrency"] != nil ||
		!reflect.DeepEqual(got["counterparty"], counterparty) || got["editable"] != false {
		t.Fatalf("перевод общий → личный у владельца: %v", got)
	}

	// Править, удалять и восстанавливать такой перевод нельзя — 403.
	for _, id := range []string{toShared, fromShared} {
		decodeProblem(t, e.as(owner, http.MethodPut, "/transactions/"+id, transferReq(shared, shared, 1, day1).json()),
			http.StatusUnprocessableEntity, "validation_failed") // тело проверяется раньше прав
		decodeProblem(t, e.as(owner, http.MethodPut, "/transactions/"+id, expenseReq(shared, products, 1, day1).json()),
			http.StatusForbidden, "transaction_readonly")
		decodeProblem(t, e.as(owner, http.MethodDelete, "/transactions/"+id, ""), http.StatusForbidden, "transaction_readonly")
		decodeProblem(t, e.as(owner, http.MethodPost, "/transactions/"+id+"/restore", ""), http.StatusForbidden, "transaction_readonly")
	}
	// Удалённый владельцем личного счёта перевод: другим — 404 на чтение, 403 на restore.
	if rec := e.as(member, http.MethodDelete, "/transactions/"+toShared, ""); rec.Code != http.StatusNoContent {
		t.Fatal(rec.Body)
	}
	decodeProblem(t, e.as(owner, http.MethodGet, "/transactions/"+toShared, ""), http.StatusNotFound, "not_found")
	decodeProblem(t, e.as(owner, http.MethodPost, "/transactions/"+toShared+"/restore", ""), http.StatusForbidden, "transaction_readonly")
	if rec := e.as(member, http.MethodPost, "/transactions/"+toShared+"/restore", ""); rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}

	// Общие операции правит любой участник.
	sharedTx := e.createTxID(t, owner, expenseReq(shared, products, 10, day1))
	rec = e.as(member, http.MethodPut, "/transactions/"+sharedTx, expenseReq(shared, products, 20, day1).json())
	if rec.Code != http.StatusOK {
		t.Fatalf("правка общей операции участником: %d %s", rec.Code, rec.Body)
	}
	if got := decodeJSON(t, rec); got["editable"] != true || !reflect.DeepEqual(got["author"], map[string]any{"id": owner.id, "name": "Иван"}) {
		t.Fatalf("после правки участником: %v", got)
	}
	// Журнал пишет того, кто правил.
	if a := e.auditOf(t, owner.familyID, sharedTx); len(a) != 2 || a[1].actor != member.id {
		t.Fatalf("журнал правки участником: %+v", a)
	}
}

// --- Гонки -------------------------------------------------------------------------

// waitForLockWait ждёт, пока какой-нибудь запрос к тестовой БД не встанет
// в ожидание блокировки (wait_event_type = 'Lock', например advisory или
// transactionid). Так тест точно знает, что запрос дошёл до блокировки.
func (e authEnv) waitForLockWait(t *testing.T, event string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		n := queryInt(t, e.pool, `SELECT count(*) FROM pg_stat_activity
			WHERE datname = current_database() AND wait_event_type = 'Lock' AND wait_event = $1`, event)
		if n > 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("запрос не дошёл до ожидания блокировки %s", event)
}

// Операция ждёт слияния категорий, а не пересекается с ним: категория
// проверяется под блокировкой, поэтому вместо нарушения внешнего ключа (500)
// клиент получает 422 invalid_category.
func TestCreateTransactionWaitsForCategoryMerge(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	cash := e.createAccount(t, u, accountBody("Наличные", "shared", 0))["id"].(string)
	gift := e.catID(t, u.familyID, "expense", "Подарки")
	ctx := context.Background()

	// Слияние «держим» вручную: та же исключительная блокировка, что у merge.
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('categories:' || $1::uuid::text, 0))`, u.familyID); err != nil {
		t.Fatal(err)
	}

	done := make(chan *httptest.ResponseRecorder)
	go func() { done <- e.as(u, http.MethodPost, "/transactions", expenseReq(cash, gift, 100, day1).json()) }()
	e.waitForLockWait(t, "advisory")

	// Пока операция ждёт, «слияние» удаляет категорию и завершается.
	if _, err := tx.Exec(ctx, `DELETE FROM categories WHERE id = $1`, gift); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	wantFieldErr(t, <-done, "categoryId:invalid_category")

	// Обычное слияние после записи операций проходит: операции переносятся.
	taxi := e.catID(t, u.familyID, "expense", "Такси")
	products := e.catID(t, u.familyID, "expense", "Продукты")
	id := e.createTxID(t, u, expenseReq(cash, taxi, 100, day1))
	if rec := e.as(u, http.MethodPost, "/categories/"+taxi+"/merge", `{"targetId":"`+products+`"}`); rec.Code != http.StatusNoContent {
		t.Fatal(rec.Body)
	}
	if got := decodeJSON(t, e.as(u, http.MethodGet, "/transactions/"+id, "")); got["categoryId"] != products {
		t.Fatalf("после слияния: %v", got)
	}
}

// Счёт удалили между проверкой и записью операции: внешний ключ → 422, не 500.
func TestCreateTransactionAccountDeletedConcurrently(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	cash := e.createAccount(t, u, accountBody("Наличные", "shared", 0))["id"].(string)
	card := e.createAccount(t, u, accountBody("Карта", "shared", 0))["id"].(string)
	ctx := context.Background()

	tx, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM accounts WHERE id = $1`, card); err != nil {
		t.Fatal(err)
	}
	// Удаление ещё не закоммичено: обработчик видит счёт, а вставка ждёт
	// блокировку строки счёта (проверка внешнего ключа).
	done := make(chan *httptest.ResponseRecorder)
	go func() { done <- e.as(u, http.MethodPost, "/transactions", transferReq(cash, card, 100, day1).json()) }()
	e.waitForLockWait(t, "transactionid")
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	wantFieldErr(t, <-done, "toAccountId:invalid_account")
}

// Правка, удаление и восстановление операции ждут корректировки остатка её
// счёта (и наоборот): иначе корректировка посчитала бы разницу от остатка,
// который тут же изменится, и итог не совпал бы с введённым. Корректировку
// «держим» вручную — та же блокировка счёта FOR UPDATE, что у adjust-balance.
func TestTransactionWriteWaitsForAdjustment(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	cash := e.createAccount(t, u, accountBody("Наличные", "shared", 0))["id"].(string)
	card := e.createAccount(t, u, accountBody("Карта", "shared", 0))["id"].(string)
	products := e.catID(t, u.familyID, "expense", "Продукты")
	id := e.createTxID(t, u, expenseReq(cash, products, 1000, day1))
	tr := e.createTxID(t, u, transferReq(card, cash, 300, day1))
	ctx := context.Background()

	steps := []struct {
		name, method, path, body string
		lock                     string // счёт, который держит «корректировка»
		status                   int
	}{
		{"правка суммы", http.MethodPut, "/transactions/" + id, expenseReq(cash, products, 2000, day1).json(), cash, http.StatusOK},
		{"удаление", http.MethodDelete, "/transactions/" + id, "", cash, http.StatusNoContent},
		{"восстановление", http.MethodPost, "/transactions/" + id + "/restore", "", cash, http.StatusOK},
		// У перевода блокируется и счёт зачисления.
		{"удаление перевода по счёту зачисления", http.MethodDelete, "/transactions/" + tr, "", cash, http.StatusNoContent},
	}
	for _, st := range steps {
		tx, err := e.pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		// При падении теста блокировка снимается, иначе удаление временной
		// БД ждало бы её вечно. Rollback после Commit ничего не делает.
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `SELECT id FROM accounts WHERE id = $1 FOR UPDATE`, st.lock); err != nil {
			t.Fatal(err)
		}
		done := make(chan *httptest.ResponseRecorder, 1)
		go func() { done <- e.as(u, st.method, st.path, st.body) }()
		e.waitForLockWait(t, "transactionid")
		select {
		case rec := <-done:
			t.Fatalf("%s не ждёт корректировки: %d %s", st.name, rec.Code, rec.Body)
		default:
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if rec := <-done; rec.Code != st.status {
			t.Fatalf("%s: %d %s", st.name, rec.Code, rec.Body)
		}
	}

	// Настоящая корректировка после правок: итог равен введённому.
	if rec := e.as(u, http.MethodPost, "/accounts/"+cash+"/adjust-balance", `{"balance":5000}`); rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}
	if got := e.balanceOf(t, u, cash); got != 5000 {
		t.Fatalf("остаток после корректировки: %d", got)
	}
}
