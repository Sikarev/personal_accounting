package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
)

// accUser — зарегистрированный пользователь: cookie сессии, id и семья.
type accUser struct {
	cookie   *http.Cookie
	id       string
	familyID string
}

func (e authEnv) newUser(t *testing.T) accUser {
	t.Helper()
	cookie, body := e.register(t, uniqueEmail())
	return accUser{
		cookie:   cookie,
		id:       body["user"].(map[string]any)["id"].(string),
		familyID: body["family"].(map[string]any)["id"].(string),
	}
}

// addMember регистрирует пользователя и переводит его в семью owner.familyID
// с ролью member. Приглашений ещё нет, поэтому — прямо в БД; сессия берёт
// семью из family_members при каждом запросе.
func (e authEnv) addMember(t *testing.T, owner accUser) accUser {
	t.Helper()
	u := e.newUser(t)
	if _, err := e.pool.Exec(context.Background(),
		`UPDATE family_members SET family_id = $1, role = 'member' WHERE user_id = $2`,
		owner.familyID, u.id); err != nil {
		t.Fatal(err)
	}
	u.familyID = owner.familyID
	return u
}

func (e authEnv) as(u accUser, method, path, body string) *httptest.ResponseRecorder {
	return e.send(method, "/api/v1"+path, body, withCookie(u.cookie))
}

// createAccount создаёт счёт и возвращает его как map (сырой JSON).
func (e authEnv) createAccount(t *testing.T, u accUser, body string) map[string]any {
	t.Helper()
	rec := e.as(u, http.MethodPost, "/accounts", body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("создание счёта: %d %s", rec.Code, rec.Body)
	}
	return decodeJSON(t, rec)
}

func accountBody(name, visibility string, initial int64) string {
	return `{"name":` + strconv.Quote(name) + `,"type":"cash","currency":"RUB","visibility":"` + visibility +
		`","initialBalance":` + strconv.FormatInt(initial, 10) + `}`
}

// listAccounts — счета из GET /accounts в порядке ответа.
func (e authEnv) listAccounts(t *testing.T, u accUser) []map[string]any {
	t.Helper()
	rec := e.as(u, http.MethodGet, "/accounts", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("список счетов: %d %s", rec.Code, rec.Body)
	}
	var body struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Items == nil {
		t.Fatalf("items — не массив: %s", rec.Body)
	}
	return body.Items
}

func (e authEnv) findAccount(t *testing.T, u accUser, id string) map[string]any {
	t.Helper()
	for _, a := range e.listAccounts(t, u) {
		if a["id"] == id {
			return a
		}
	}
	return nil
}

func ids(accs []map[string]any) []string {
	out := make([]string, 0, len(accs))
	for _, a := range accs {
		out = append(out, a["id"].(string))
	}
	return out
}

// balanceOf — остаток счёта из списка. JSON-числа в map — float64; остатки
// в тестах малы, точность не теряется.
func (e authEnv) balanceOf(t *testing.T, u accUser, id string) int64 {
	t.Helper()
	a := e.findAccount(t, u, id)
	if a == nil {
		t.Fatalf("счёт %s не найден в списке", id)
	}
	return int64(a["balance"].(float64))
}

// txOpts — операция, вставляемая прямо в БД (API операций ещё нет).
type txOpts struct {
	kind      string
	account   string
	amount    int64
	toAccount string
	toAmount  int64
	deleted   bool
}

func (e authEnv) insertTx(t *testing.T, familyID string, o txOpts) {
	t.Helper()
	ctx := context.Background()
	var category, toAccount, toAmount any
	switch o.kind {
	case "expense", "income":
		var id string
		if err := e.pool.QueryRow(ctx, `SELECT id FROM categories WHERE family_id = $1 AND kind = $2 LIMIT 1`,
			familyID, o.kind).Scan(&id); err != nil {
			t.Fatal(err)
		}
		category = id
	case "transfer":
		toAccount, toAmount = o.toAccount, o.toAmount
	}
	var deletedAt any
	if o.deleted {
		deletedAt = time.Now()
	}
	if _, err := e.pool.Exec(ctx, `
		INSERT INTO transactions (family_id, kind, account_id, amount, to_account_id, to_amount, category_id, op_date, deleted_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, current_date, $8)`,
		familyID, o.kind, o.account, o.amount, toAccount, toAmount, category, deletedAt); err != nil {
		t.Fatalf("вставка операции %+v: %v", o, err)
	}
}

func TestAccountCRUD(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)

	// Новый пользователь: счетов нет, список — [], а не null.
	if got := e.listAccounts(t, u); len(got) != 0 {
		t.Fatalf("у нового пользователя счета: %v", got)
	}

	// Все поля, имя с пробелами по краям, отрицательный остаток (кредитка).
	acc := e.createAccount(t, u, `{"name":"  Кредитка  ","type":"credit_card","currency":"USD",
		"initialBalance":-150050,"visibility":"private","includeInTotal":false,"color":"grape"}`)
	keys := make([]string, 0, len(acc))
	for k := range acc {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	wantKeys := []string{"archivedAt", "balance", "color", "currency", "hasTransactions", "id",
		"includeInTotal", "initialBalance", "name", "sortOrder", "type", "visibility"}
	if !reflect.DeepEqual(keys, wantKeys) {
		t.Fatalf("поля счёта: %v, ожидались %v", keys, wantKeys)
	}
	want := map[string]any{
		"id": acc["id"], "name": "Кредитка", "type": "credit_card", "currency": "USD",
		"visibility": "private", "initialBalance": float64(-150050), "balance": float64(-150050),
		"includeInTotal": false, "color": "grape", "sortOrder": float64(0), "archivedAt": nil,
		"hasTransactions": false,
	}
	if !reflect.DeepEqual(acc, want) {
		t.Fatalf("счёт:\n%v\nожидался\n%v", acc, want)
	}
	id := acc["id"].(string)

	// Минимальный запрос: умолчания.
	minimal := e.createAccount(t, u, `{"name":"Наличные","type":"cash","currency":"RUB","visibility":"shared"}`)
	if minimal["initialBalance"] != float64(0) || minimal["includeInTotal"] != true ||
		minimal["color"] != nil || minimal["visibility"] != "shared" {
		t.Fatalf("умолчания: %v", minimal)
	}

	// Полная замена редактируемых полей; валюта и видимость не меняются.
	rec := e.as(u, http.MethodPut, "/accounts/"+id,
		`{"name":" Карта ","type":"card","initialBalance":500,"includeInTotal":true,"color":null}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("изменение: %d %s", rec.Code, rec.Body)
	}
	upd := decodeJSON(t, rec)
	if upd["name"] != "Карта" || upd["type"] != "card" || upd["initialBalance"] != float64(500) ||
		upd["balance"] != float64(500) || upd["includeInTotal"] != true || upd["color"] != nil ||
		upd["currency"] != "USD" || upd["visibility"] != "private" {
		t.Fatalf("после изменения: %v", upd)
	}
	// color обязателен в PUT (полная замена): без него — 422.
	rec = e.as(u, http.MethodPut, "/accounts/"+id, `{"name":"Карта","type":"card","initialBalance":500,"includeInTotal":true}`)
	if got := fieldErrors(t, decodeProblem(t, rec, http.StatusUnprocessableEntity, "validation_failed")); !slices.Contains(got, "color:required") {
		t.Fatalf("PUT без color: %v", got)
	}

	// Архив идемпотентен: повторный вызов не сдвигает archivedAt.
	rec = e.as(u, http.MethodPost, "/accounts/"+id+"/archive", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("архив: %d %s", rec.Code, rec.Body)
	}
	archivedAt := decodeJSON(t, rec)["archivedAt"]
	if archivedAt == nil {
		t.Fatal("archivedAt пуст после архивации")
	}
	e.clock.Advance(time.Minute)
	rec = e.as(u, http.MethodPost, "/accounts/"+id+"/archive", "")
	if rec.Code != http.StatusOK || decodeJSON(t, rec)["archivedAt"] != archivedAt {
		t.Fatalf("повторный архив: %d %s (было %v)", rec.Code, rec.Body, archivedAt)
	}
	// Архивные счета есть в списке.
	if a := e.findAccount(t, u, id); a == nil || a["archivedAt"] != archivedAt {
		t.Fatalf("архивный счёт в списке: %v", a)
	}
	for range 2 {
		rec = e.as(u, http.MethodPost, "/accounts/"+id+"/unarchive", "")
		if rec.Code != http.StatusOK || decodeJSON(t, rec)["archivedAt"] != nil {
			t.Fatalf("разархивация: %d %s", rec.Code, rec.Body)
		}
	}

	// Удаление пустого счёта.
	rec = e.as(u, http.MethodDelete, "/accounts/"+id, "")
	if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Fatalf("удаление: %d %s", rec.Code, rec.Body)
	}
	if got := ids(e.listAccounts(t, u)); !reflect.DeepEqual(got, []string{minimal["id"].(string)}) {
		t.Fatalf("после удаления: %v", got)
	}
	decodeProblem(t, e.as(u, http.MethodDelete, "/accounts/"+id, ""), http.StatusNotFound, "not_found")
	decodeProblem(t, e.as(u, http.MethodPut, "/accounts/"+id,
		`{"name":"x","type":"card","initialBalance":0,"includeInTotal":true,"color":null}`), http.StatusNotFound, "not_found")
}

func TestCreateAccountValidation(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	for _, c := range []struct {
		body, want string
	}{
		// EUR есть в справочнике, но не активна.
		{`{"name":"Евро","type":"cash","currency":"EUR","visibility":"shared"}`, "currency:invalid_value"},
		{`{"name":"Неизвестная","type":"cash","currency":"XXX","visibility":"shared"}`, "currency:invalid_value"},
		{`{"name":"   ","type":"cash","currency":"RUB","visibility":"shared"}`, "name:required"},
		{`{"name":"a\u0000b","type":"cash","currency":"RUB","visibility":"shared"}`, "name:invalid_format"},
		{`{"name":"` + strings.Repeat("я", 101) + `","type":"cash","currency":"RUB","visibility":"shared"}`, "name:too_long"},
		{`{"name":"x","type":"cash","currency":"RUB","visibility":"shared","color":"brown"}`, "color:invalid_value"},
		{`{"name":"x","type":"wallet","currency":"RUB","visibility":"shared"}`, "type:invalid_value"},
		{`{"name":"x","type":"cash","currency":"RUB","visibility":"public"}`, "visibility:invalid_value"},
		{`{"name":"x","type":"cash","currency":"RUB","visibility":"shared","initialBalance":1000000000000001}`, "initialBalance:too_large"},
		{`{"name":"x","type":"cash","currency":"RUB","visibility":"shared","initialBalance":1.5}`, "initialBalance:invalid_type"},
		{`{"name":"x","type":"cash","currency":"RUB","visibility":"shared","balance":1}`, "balance:unknown_field"},
	} {
		rec := e.as(u, http.MethodPost, "/accounts", c.body)
		got := fieldErrors(t, decodeProblem(t, rec, http.StatusUnprocessableEntity, "validation_failed"))
		if !slices.Contains(got, c.want) {
			t.Errorf("%s: ошибки %v, ожидалась %s", c.body, got, c.want)
		}
	}
	if n := len(e.listAccounts(t, u)); n != 0 {
		t.Fatalf("после ошибок создано счетов: %d", n)
	}
}

func TestAccountOrder(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	a := e.createAccount(t, u, accountBody("A", "shared", 0))
	b := e.createAccount(t, u, accountBody("B", "shared", 0))
	c := e.createAccount(t, u, accountBody("C", "shared", 0))
	p := e.createAccount(t, u, accountBody("P", "private", 0))
	// Новый счёт — в конец своей группы.
	for i, acc := range []map[string]any{a, b, c, p} {
		want := []float64{0, 1, 2, 0}[i]
		if acc["sortOrder"] != want {
			t.Errorf("%v: sortOrder %v, ожидался %v", acc["name"], acc["sortOrder"], want)
		}
	}
	aID, bID, cID, pID := a["id"].(string), b["id"].(string), c["id"].(string), p["id"].(string)

	rec := e.as(u, http.MethodPut, "/accounts/order", `{"accountIds":["`+cID+`","`+aID+`","`+bID+`"]}`)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("порядок: %d %s", rec.Code, rec.Body)
	}
	// Общие: C(0), A(1), B(2); личный P(0) — между группами номера пересекаются,
	// при равном sortOrder порядок — по времени создания.
	if got, want := ids(e.listAccounts(t, u)), []string{cID, pID, aID, bID}; !reflect.DeepEqual(got, want) {
		t.Fatalf("порядок после сортировки: %v, ожидался %v", got, want)
	}
	// Следующий новый счёт — в конец своей группы.
	if d := e.createAccount(t, u, accountBody("D", "shared", 0)); d["sortOrder"] != float64(3) {
		t.Fatalf("новый после сортировки: sortOrder %v", d["sortOrder"])
	}

	// Неизвестный id — 404, порядок не меняется (вся операция откатывается).
	before := ids(e.listAccounts(t, u))
	decodeProblem(t, e.as(u, http.MethodPut, "/accounts/order",
		`{"accountIds":["`+bID+`","`+aID+`","0193b7c2-1f7e-7c4e-9a51-3c2d1e0f9a8b"]}`), http.StatusNotFound, "not_found")
	if got := ids(e.listAccounts(t, u)); !reflect.DeepEqual(got, before) {
		t.Fatalf("порядок изменился после 404: %v, был %v", got, before)
	}

	// Повторы и пустой список отклоняет контракт.
	decodeProblem(t, e.as(u, http.MethodPut, "/accounts/order", `{"accountIds":["`+aID+`","`+aID+`"]}`),
		http.StatusUnprocessableEntity, "validation_failed")
	// Тот же UUID в другом регистре uniqueItems не ловит — ловит обработчик.
	got := fieldErrors(t, decodeProblem(t, e.as(u, http.MethodPut, "/accounts/order",
		`{"accountIds":["`+aID+`","`+strings.ToUpper(aID)+`"]}`), http.StatusUnprocessableEntity, "validation_failed"))
	if !reflect.DeepEqual(got, []string{"accountIds:invalid"}) {
		t.Fatalf("повтор в другом регистре: %v", got)
	}
	got = fieldErrors(t, decodeProblem(t, e.as(u, http.MethodPut, "/accounts/order", `{"accountIds":[]}`),
		http.StatusUnprocessableEntity, "validation_failed"))
	if !slices.Contains(got, "accountIds:too_few_items") {
		t.Fatalf("пустой список: %v", got)
	}
}

func TestAccountBalance(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	a := e.createAccount(t, u, accountBody("A", "shared", 10000))["id"].(string)
	b := e.createAccount(t, u, accountBody("B", "shared", 0))["id"].(string)

	e.insertTx(t, u.familyID, txOpts{kind: "expense", account: a, amount: -3000})
	e.insertTx(t, u.familyID, txOpts{kind: "income", account: a, amount: 5000})
	e.insertTx(t, u.familyID, txOpts{kind: "transfer", account: a, amount: -2000, toAccount: b, toAmount: 2000})
	e.insertTx(t, u.familyID, txOpts{kind: "transfer", account: b, amount: -700, toAccount: a, toAmount: 700})
	e.insertTx(t, u.familyID, txOpts{kind: "adjustment", account: a, amount: -1})
	// Удалённые операции в остаток не входят.
	e.insertTx(t, u.familyID, txOpts{kind: "expense", account: a, amount: -99999, deleted: true})
	e.insertTx(t, u.familyID, txOpts{kind: "transfer", account: b, amount: -500, toAccount: a, toAmount: 500, deleted: true})

	// A: 10000 − 3000 + 5000 − 2000 + 700 − 1 = 10699; B: 2000 − 700 = 1300.
	if got := e.balanceOf(t, u, a); got != 10699 {
		t.Errorf("остаток A = %d, ожидался 10699", got)
	}
	if got := e.balanceOf(t, u, b); got != 1300 {
		t.Errorf("остаток B = %d, ожидался 1300", got)
	}
	if acc := e.findAccount(t, u, a); acc["hasTransactions"] != true || acc["initialBalance"] != float64(10000) {
		t.Errorf("A: %v", acc)
	}
}

func TestAdjustBalance(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	id := e.createAccount(t, u, accountBody("Наличные", "shared", 10000))["id"].(string)
	ctx := context.Background()

	// Часы: 20:00 UTC — во Владивостоке (UTC+10) уже следующий день.
	day := e.clock.Now().UTC().Truncate(24 * time.Hour)
	e.clock.Advance(day.Add(20 * time.Hour).Sub(e.clock.Now()))
	if _, err := e.pool.Exec(ctx, `UPDATE users SET timezone = 'Asia/Vladivostok' WHERE id = $1`, u.id); err != nil {
		t.Fatal(err)
	}

	adjust := func(balance int64) map[string]any {
		t.Helper()
		rec := e.as(u, http.MethodPost, "/accounts/"+id+"/adjust-balance", `{"balance":`+strconv.FormatInt(balance, 10)+`}`)
		if rec.Code != http.StatusOK {
			t.Fatalf("корректировка до %d: %d %s", balance, rec.Code, rec.Body)
		}
		return decodeJSON(t, rec)
	}

	// Остаток меньше фактического: корректировка в плюс.
	resp := adjust(12500)
	txID, _ := resp["transactionId"].(string)
	if txID == "" {
		t.Fatalf("нет transactionId: %v", resp)
	}
	if acc := resp["account"].(map[string]any); acc["balance"] != float64(12500) || acc["hasTransactions"] != true {
		t.Fatalf("счёт после корректировки: %v", acc)
	}
	var kind string
	var amount int64
	var opDate time.Time
	var createdBy string
	if err := e.pool.QueryRow(ctx, `SELECT kind, amount, op_date, created_by FROM transactions WHERE id = $1 AND family_id = $2`,
		txID, u.familyID).Scan(&kind, &amount, &opDate, &createdBy); err != nil {
		t.Fatal(err)
	}
	wantDate := day.AddDate(0, 0, 1)
	if kind != "adjustment" || amount != 2500 || !opDate.Equal(wantDate) || createdBy != u.id {
		t.Fatalf("операция: %s %d %s %s; ожидались adjustment 2500 %s %s", kind, amount, opDate, createdBy, wantDate, u.id)
	}

	// Журнал изменений: запись о создании со снимком операции в формате API
	// (как у остальных операций, см. transactionSnapshot).
	var actor, entityType, action string
	var after map[string]any
	if err := e.pool.QueryRow(ctx, `
		SELECT actor_user_id, entity_type, action, after FROM audit_log
		WHERE family_id = $1 AND entity_id = $2`, u.familyID, txID).Scan(&actor, &entityType, &action, &after); err != nil {
		t.Fatal(err)
	}
	if actor != u.id || entityType != "transaction" || action != "create" ||
		after["id"] != txID || after["kind"] != "adjustment" || after["amount"] != float64(2500) ||
		after["accountId"] != id || after["currency"] != "RUB" || after["authorId"] != u.id ||
		after["date"] != wantDate.Format(time.DateOnly) {
		t.Fatalf("audit_log: %s %s %s %v", actor, entityType, action, after)
	}

	// Остаток больше фактического: корректировка в минус, в т. ч. ниже нуля.
	// Часы: 02:00 UTC следующего дня — в Нью-Йорке ещё предыдущий день.
	if _, err := e.pool.Exec(ctx, `UPDATE users SET timezone = 'America/New_York' WHERE id = $1`, u.id); err != nil {
		t.Fatal(err)
	}
	e.clock.Advance(6 * time.Hour) // day+1 02:00 UTC → day 21:00/22:00 в Нью-Йорке
	resp = adjust(-300)
	txID = resp["transactionId"].(string)
	if err := e.pool.QueryRow(ctx, `SELECT amount, op_date FROM transactions WHERE id = $1`, txID).Scan(&amount, &opDate); err != nil {
		t.Fatal(err)
	}
	if amount != -12800 || !opDate.Equal(day) {
		t.Fatalf("корректировка в минус: %d %s, ожидались -12800 %s", amount, opDate, day)
	}
	if got := e.balanceOf(t, u, id); got != -300 {
		t.Fatalf("остаток после корректировок: %d", got)
	}

	// Разница 0: операции нет, transactionId в ответе нет.
	before := queryInt(t, e.pool, `SELECT count(*) FROM transactions WHERE account_id = $1`, id)
	resp = adjust(-300)
	if _, ok := resp["transactionId"]; ok {
		t.Fatalf("при нулевой разнице есть transactionId: %v", resp)
	}
	if resp["account"].(map[string]any)["balance"] != float64(-300) {
		t.Fatalf("при нулевой разнице: %v", resp)
	}
	if n := queryInt(t, e.pool, `SELECT count(*) FROM transactions WHERE account_id = $1`, id); n != before {
		t.Fatalf("при нулевой разнице создана операция: %d → %d", before, n)
	}
	if n := queryInt(t, e.pool, `SELECT count(*) FROM audit_log WHERE family_id = $1`, u.familyID); n != 2 {
		t.Fatalf("записей в audit_log: %d, ожидалось 2", n)
	}

	// Архивный счёт корректировать нельзя.
	if rec := e.as(u, http.MethodPost, "/accounts/"+id+"/archive", ""); rec.Code != http.StatusOK {
		t.Fatalf("архив: %d %s", rec.Code, rec.Body)
	}
	decodeProblem(t, e.as(u, http.MethodPost, "/accounts/"+id+"/adjust-balance", `{"balance":0}`),
		http.StatusConflict, "account_archived")
}

func TestDeleteAccountWithTransactions(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	other := e.createAccount(t, u, accountBody("Другой", "shared", 0))["id"].(string)

	for _, c := range []struct {
		name string
		tx   func(id string) txOpts
	}{
		{"расход", func(id string) txOpts { return txOpts{kind: "expense", account: id, amount: -100} }},
		{"удалённый расход", func(id string) txOpts { return txOpts{kind: "expense", account: id, amount: -100, deleted: true} }},
		{"получатель перевода", func(id string) txOpts {
			return txOpts{kind: "transfer", account: other, amount: -100, toAccount: id, toAmount: 100}
		}},
		{"удалённый перевод на счёт", func(id string) txOpts {
			return txOpts{kind: "transfer", account: other, amount: -100, toAccount: id, toAmount: 100, deleted: true}
		}},
	} {
		id := e.createAccount(t, u, accountBody(c.name, "shared", 0))["id"].(string)
		e.insertTx(t, u.familyID, c.tx(id))
		if a := e.findAccount(t, u, id); a["hasTransactions"] != true {
			t.Errorf("%s: hasTransactions = %v", c.name, a["hasTransactions"])
		}
		decodeProblem(t, e.as(u, http.MethodDelete, "/accounts/"+id, ""), http.StatusConflict, "account_has_transactions")
		if e.findAccount(t, u, id) == nil {
			t.Errorf("%s: счёт удалён несмотря на 409", c.name)
		}
	}
}

// accountOps — все операции API над одним счётом с ожидаемым успешным статусом.
func accountOps(id string) []struct{ method, path, body string } {
	return []struct{ method, path, body string }{
		{http.MethodPut, "/accounts/" + id, `{"name":"Чужой","type":"cash","initialBalance":0,"includeInTotal":true,"color":null}`},
		{http.MethodPost, "/accounts/" + id + "/archive", ""},
		{http.MethodPost, "/accounts/" + id + "/unarchive", ""},
		{http.MethodPost, "/accounts/" + id + "/adjust-balance", `{"balance":777}`},
		{http.MethodPut, "/accounts/order", `{"accountIds":["` + id + `"]}`},
		{http.MethodDelete, "/accounts/" + id, ""},
	}
}

// expectAccountHidden проверяет, что счёт id не виден u: его нет в списке,
// любая операция с ним — 404, и в БД он не изменился.
func (e authEnv) expectAccountHidden(t *testing.T, u accUser, id string) {
	t.Helper()
	if slices.Contains(ids(e.listAccounts(t, u)), id) {
		t.Fatalf("счёт %s виден в списке", id)
	}
	snapshot := func() string {
		var s string
		if err := e.pool.QueryRow(context.Background(),
			`SELECT row_to_json(a)::text FROM accounts a WHERE id = $1`, id).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	before := snapshot()
	txBefore := queryInt(t, e.pool, `SELECT count(*) FROM transactions WHERE account_id = $1`, id)
	for _, op := range accountOps(id) {
		decodeProblem(t, e.as(u, op.method, op.path, op.body), http.StatusNotFound, "not_found")
	}
	if after := snapshot(); after != before {
		t.Fatalf("невидимый счёт изменился:\n%s\n%s", before, after)
	}
	if n := queryInt(t, e.pool, `SELECT count(*) FROM transactions WHERE account_id = $1`, id); n != txBefore {
		t.Fatal("по невидимому счёту создана операция")
	}
}

func TestAccountsFamilyIsolation(t *testing.T) {
	e := newAuthEnv(t, Options{})
	alice, bob := e.newUser(t), e.newUser(t)
	shared := e.createAccount(t, alice, accountBody("Общий Алисы", "shared", 100))["id"].(string)
	private := e.createAccount(t, alice, accountBody("Личный Алисы", "private", 100))["id"].(string)
	own := e.createAccount(t, bob, accountBody("Свой", "shared", 0))["id"].(string)

	if got := ids(e.listAccounts(t, bob)); !reflect.DeepEqual(got, []string{own}) {
		t.Fatalf("Боб видит: %v", got)
	}
	e.expectAccountHidden(t, bob, shared)
	e.expectAccountHidden(t, bob, private)

	// Свой счёт вперемешку с чужим — 404 целиком, свой порядок не меняется.
	decodeProblem(t, e.as(bob, http.MethodPut, "/accounts/order", `{"accountIds":["`+own+`","`+shared+`"]}`),
		http.StatusNotFound, "not_found")

	// У Алисы всё на месте.
	if got := ids(e.listAccounts(t, alice)); !reflect.DeepEqual(got, []string{shared, private}) {
		t.Fatalf("Алиса видит: %v", got)
	}
}

func TestPrivateAccountVisibility(t *testing.T) {
	e := newAuthEnv(t, Options{})
	owner := e.newUser(t)
	member := e.addMember(t, owner)
	shared := e.createAccount(t, owner, accountBody("Общий", "shared", 1000))["id"].(string)
	private := e.createAccount(t, owner, accountBody("Личный владельца", "private", 1000))["id"].(string)
	memberPrivate := e.createAccount(t, member, accountBody("Личный участника", "private", 0))

	// Личный счёт участника — тоже private с его точки зрения, у владельца его нет.
	if memberPrivate["visibility"] != "private" {
		t.Fatalf("visibility у участника: %v", memberPrivate["visibility"])
	}
	if got := ids(e.listAccounts(t, owner)); !reflect.DeepEqual(got, []string{shared, private}) {
		t.Fatalf("владелец видит: %v", got)
	}
	if got := ids(e.listAccounts(t, member)); !reflect.DeepEqual(got, []string{shared, memberPrivate["id"].(string)}) {
		t.Fatalf("участник видит: %v", got)
	}
	e.expectAccountHidden(t, member, private)
	e.expectAccountHidden(t, owner, memberPrivate["id"].(string))

	// Общий счёт участник видит и может менять — изменения видны владельцу.
	rec := e.as(member, http.MethodPut, "/accounts/"+shared,
		`{"name":"Общий (правка)","type":"card","initialBalance":1000,"includeInTotal":true,"color":"teal"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("участник меняет общий: %d %s", rec.Code, rec.Body)
	}
	rec = e.as(member, http.MethodPost, "/accounts/"+shared+"/adjust-balance", `{"balance":1500}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("участник корректирует общий: %d %s", rec.Code, rec.Body)
	}
	if rec := e.as(member, http.MethodPut, "/accounts/order", `{"accountIds":["`+shared+`"]}`); rec.Code != http.StatusNoContent {
		t.Fatalf("участник сортирует общий: %d %s", rec.Code, rec.Body)
	}
	a := e.findAccount(t, owner, shared)
	if a["name"] != "Общий (правка)" || a["color"] != "teal" || a["balance"] != float64(1500) || a["visibility"] != "shared" {
		t.Fatalf("владелец видит общий: %v", a)
	}
}
