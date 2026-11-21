package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"slices"
	"testing"
	"time"
)

// catUser — зарегистрированный пользователь со своей семьёй (и набором
// категорий по умолчанию).
type catUser struct {
	e        authEnv
	cookie   *http.Cookie
	familyID string
	userID   string
}

func newCatUser(t *testing.T, e authEnv) catUser {
	t.Helper()
	cookie, body := e.register(t, uniqueEmail())
	return catUser{
		e:        e,
		cookie:   cookie,
		familyID: body["family"].(map[string]any)["id"].(string),
		userID:   body["user"].(map[string]any)["id"].(string),
	}
}

func (u catUser) send(method, path, body string) (int, map[string]any) {
	rec := u.e.send(method, "/api/v1"+path, body, withCookie(u.cookie))
	var m map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &m)
	return rec.Code, m
}

// list — все категории семьи в порядке ответа.
func (u catUser) list(t *testing.T) []map[string]any {
	t.Helper()
	code, body := u.send(http.MethodGet, "/categories", "")
	if code != http.StatusOK {
		t.Fatalf("список: %d %v", code, body)
	}
	var out []map[string]any
	for _, it := range body["items"].([]any) {
		out = append(out, it.(map[string]any))
	}
	return out
}

// find — категория по виду, родителю (имя или "" для верхнего уровня) и имени.
func (u catUser) find(t *testing.T, kind, parent, name string) map[string]any {
	t.Helper()
	items := u.list(t)
	parentID := any(nil)
	if parent != "" {
		parentID = findIn(t, items, kind, nil, parent)["id"]
	}
	return findIn(t, items, kind, parentID, name)
}

func findIn(t *testing.T, items []map[string]any, kind string, parentID any, name string) map[string]any {
	t.Helper()
	for _, c := range items {
		if c["kind"] == kind && c["parentId"] == parentID && c["name"] == name {
			return c
		}
	}
	t.Fatalf("нет категории %s/%v/%q", kind, parentID, name)
	return nil
}

func (u catUser) id(t *testing.T, kind, parent, name string) string {
	t.Helper()
	return u.find(t, kind, parent, name)["id"].(string)
}

// siblings — имена соседей в порядке списка и проверка, что sortOrder
// идёт 1..n без пропусков и дублей.
func (u catUser) siblings(t *testing.T, kind string, parentID any) []string {
	t.Helper()
	var names []string
	for _, c := range u.list(t) {
		if c["kind"] == kind && c["parentId"] == parentID {
			names = append(names, c["name"].(string))
			if got := int(c["sortOrder"].(float64)); got != len(names) {
				t.Errorf("%q: sortOrder %d, ожидалось %d", c["name"], got, len(names))
			}
		}
	}
	return names
}

func (u catUser) create(t *testing.T, kind string, parentID any, name string) map[string]any {
	t.Helper()
	code, body := u.send(http.MethodPost, "/categories", createCatBody(kind, parentID, name))
	if code != http.StatusCreated {
		t.Fatalf("создание %q: %d %v", name, code, body)
	}
	return body
}

func createCatBody(kind string, parentID any, name string) string {
	b, _ := json.Marshal(map[string]any{"kind": kind, "parentId": parentID, "name": name})
	return string(b)
}

func moveBody(parentID any, index int) string {
	b, _ := json.Marshal(map[string]any{"parentId": parentID, "index": index})
	return string(b)
}

func wantFieldError(t *testing.T, code int, body map[string]any, want string) {
	t.Helper()
	if code != http.StatusUnprocessableEntity {
		t.Fatalf("статус %d, ожидался 422 %s; %v", code, want, body)
	}
	if got := fieldErrors(t, body); !reflect.DeepEqual(got, []string{want}) {
		t.Fatalf("ошибки %v, ожидалось %s", got, want)
	}
}

func wantNotFound(t *testing.T, code int, body map[string]any) {
	t.Helper()
	if code != http.StatusNotFound || body["code"] != "not_found" {
		t.Fatalf("ожидался 404 not_found: %d %v", code, body)
	}
}

func TestListCategoriesAfterRegister(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := newCatUser(t, e)

	rec := e.send(http.MethodGet, "/api/v1/categories", "", withCookie(u.cookie))
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	// Сырой JSON: ровно поле items, у категории — ровно шесть полей.
	var raw map[string][]map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil || len(raw) != 1 {
		t.Fatalf("тело: %v %s", err, rec.Body)
	}
	items := raw["items"]
	if len(items) != 34 { // 17 + 12 расходов, 5 доходов
		t.Fatalf("категорий %d", len(items))
	}
	first := items[0]
	keys := make([]string, 0, len(first))
	for k := range first {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	if !reflect.DeepEqual(keys, []string{"archivedAt", "id", "kind", "name", "parentId", "sortOrder"}) {
		t.Fatalf("поля категории: %v", keys)
	}
	if string(first["kind"]) != `"expense"` || string(first["name"]) != `"Продукты"` ||
		string(first["parentId"]) != "null" || string(first["archivedAt"]) != "null" || string(first["sortOrder"]) != "1" {
		t.Fatalf("первая категория: %s", rec.Body.Bytes()[:300])
	}

	// Расходы идут раньше доходов; подкатегория ссылается на родителя.
	list := u.list(t)
	if list[len(list)-1]["kind"] != "income" {
		t.Fatal("доходы должны идти после расходов")
	}
	transport := findIn(t, list, "expense", nil, "Транспорт")
	taxi := findIn(t, list, "expense", transport["id"], "Такси")
	if taxi["sortOrder"].(float64) != 2 {
		t.Fatalf("Такси: %v", taxi)
	}
	if got := u.siblings(t, "income", nil); !reflect.DeepEqual(got, []string{"Зарплата", "Подработка", "Проценты и кешбэк", "Подарки", "Прочее"}) {
		t.Fatalf("доходы: %v", got)
	}

	// Без входа — 401.
	if rec := e.send(http.MethodGet, "/api/v1/categories", ""); rec.Code != http.StatusUnauthorized {
		t.Fatalf("без входа: %d", rec.Code)
	}
}

func TestCreateCategory(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := newCatUser(t, e)

	// Верхний уровень: в конец, пробелы по краям обрезаются.
	c := u.create(t, "expense", nil, "  Животные  ")
	if c["name"] != "Животные" || c["parentId"] != nil || c["archivedAt"] != nil || c["kind"] != "expense" || c["sortOrder"].(float64) != 18 {
		t.Fatalf("создана: %v", c)
	}
	// Подкатегория: в конец среди подкатегорий родителя.
	transport := u.id(t, "expense", "", "Транспорт")
	sub := u.create(t, "expense", transport, "Самокат")
	if sub["parentId"] != transport || sub["sortOrder"].(float64) != 3 {
		t.Fatalf("подкатегория: %v", sub)
	}
	// То же имя в другом месте дерева и в другом виде — можно.
	u.create(t, "expense", transport, "Подарки")
	u.create(t, "income", nil, "Продукты")
	// Имя с другим регистром — другое имя (уникальность точная, как в индексе).
	u.create(t, "expense", nil, "продукты")

	taxi := u.id(t, "expense", "Транспорт", "Такси")
	salary := u.id(t, "income", "", "Зарплата")
	cases := []struct {
		name, body, want string
	}{
		{"занятое имя", createCatBody("expense", nil, "Продукты"), "name:name_taken"},
		{"занятое имя после обрезки", createCatBody("expense", transport, " Такси "), "name:name_taken"},
		{"пустое после обрезки", createCatBody("expense", nil, "   "), "name:required"},
		{"длиннее 60", createCatBody("expense", nil, longName(61)), "name:too_long"},
		{"глубина 3", createCatBody("expense", taxi, "Ночное такси"), "parentId:invalid_parent"},
		{"родитель другого вида", createCatBody("expense", salary, "Премия"), "parentId:invalid_parent"},
		{"несуществующий родитель", createCatBody("expense", "0193b7c2-1f7e-7c4e-9a51-3c2d1e0f9a8b", "X"), "parentId:invalid_parent"},
		{"лишнее поле", `{"kind":"expense","name":"X","color":"red"}`, "color:unknown_field"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, body := u.send(http.MethodPost, "/categories", tc.body)
			wantFieldError(t, code, body, tc.want)
		})
	}
	// 60 символов — можно.
	u.create(t, "expense", nil, longName(60))

	// Архивный родитель не принимается.
	health := u.id(t, "expense", "", "Здоровье")
	if code, body := u.send(http.MethodPost, "/categories/"+health+"/archive", ""); code != http.StatusOK {
		t.Fatalf("архив: %d %v", code, body)
	}
	code, body := u.send(http.MethodPost, "/categories", createCatBody("expense", health, "Стоматолог"))
	wantFieldError(t, code, body, "parentId:invalid_parent")
	// Имя архивной категории занято.
	code, body = u.send(http.MethodPost, "/categories", createCatBody("expense", nil, "Здоровье"))
	wantFieldError(t, code, body, "name:name_taken")
}

func longName(n int) string {
	r := make([]rune, n)
	for i := range r {
		r[i] = 'я'
	}
	return string(r)
}

func TestUpdateCategory(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := newCatUser(t, e)
	id := u.id(t, "expense", "", "Продукты")

	code, body := u.send(http.MethodPut, "/categories/"+id, `{"name":" Еда "}`)
	if code != http.StatusOK || body["name"] != "Еда" || body["id"] != id || body["sortOrder"].(float64) != 1 {
		t.Fatalf("переименование: %d %v", code, body)
	}
	// Своё же имя — не конфликт.
	if code, body := u.send(http.MethodPut, "/categories/"+id, `{"name":"Еда"}`); code != http.StatusOK {
		t.Fatalf("то же имя: %d %v", code, body)
	}
	code, body = u.send(http.MethodPut, "/categories/"+id, `{"name":"Транспорт"}`)
	wantFieldError(t, code, body, "name:name_taken")
	code, body = u.send(http.MethodPut, "/categories/"+id, `{"name":""}`)
	wantFieldError(t, code, body, "name:too_short")
	code, body = u.send(http.MethodPut, "/categories/0193b7c2-1f7e-7c4e-9a51-3c2d1e0f9a8b", `{"name":"X"}`)
	wantNotFound(t, code, body)
}

func TestMoveCategory(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := newCatUser(t, e)
	transport := u.id(t, "expense", "", "Транспорт")
	auto := u.id(t, "expense", "", "Автомобиль")

	move := func(t *testing.T, id string, parent any, index int) map[string]any {
		t.Helper()
		code, body := u.send(http.MethodPost, "/categories/"+id+"/move", moveBody(parent, index))
		if code != http.StatusOK {
			t.Fatalf("перемещение: %d %v", code, body)
		}
		return body
	}

	// Внутри соседей: вниз и вверх.
	fuel := u.id(t, "expense", "Автомобиль", "Топливо")
	move(t, fuel, auto, 2)
	if got := u.siblings(t, "expense", auto); !reflect.DeepEqual(got, []string{"Обслуживание", "Парковка", "Топливо"}) {
		t.Fatalf("вниз: %v", got)
	}
	parking := u.id(t, "expense", "Автомобиль", "Парковка")
	moved := move(t, parking, auto, 0)
	if moved["sortOrder"].(float64) != 1 || moved["parentId"] != auto {
		t.Fatalf("ответ: %v", moved)
	}
	if got := u.siblings(t, "expense", auto); !reflect.DeepEqual(got, []string{"Парковка", "Обслуживание", "Топливо"}) {
		t.Fatalf("вверх: %v", got)
	}

	// В другого родителя: старые соседи сдвигаются, новые раздвигаются.
	move(t, parking, transport, 1)
	if got := u.siblings(t, "expense", auto); !reflect.DeepEqual(got, []string{"Обслуживание", "Топливо"}) {
		t.Fatalf("старые соседи: %v", got)
	}
	if got := u.siblings(t, "expense", transport); !reflect.DeepEqual(got, []string{"Общественный транспорт", "Парковка", "Такси"}) {
		t.Fatalf("новые соседи: %v", got)
	}

	// На верхний уровень с index за пределами — в конец.
	moved = move(t, parking, nil, 1000)
	if moved["parentId"] != nil || moved["sortOrder"].(float64) != 18 {
		t.Fatalf("на верхний уровень: %v", moved)
	}
	top := u.siblings(t, "expense", nil)
	if len(top) != 18 || top[17] != "Парковка" {
		t.Fatalf("верхний уровень: %v", top)
	}
	u.siblings(t, "expense", transport) // перенумерованы без пропусков

	// Категорию верхнего уровня без подкатегорий — в подкатегории (в начало).
	parkingMoved := move(t, parking, auto, 0)
	if parkingMoved["parentId"] != auto {
		t.Fatalf("в подкатегории: %v", parkingMoved)
	}
	if got := u.siblings(t, "expense", auto); !reflect.DeepEqual(got, []string{"Парковка", "Обслуживание", "Топливо"}) {
		t.Fatalf("в подкатегории: %v", got)
	}
	if got := u.siblings(t, "expense", nil); len(got) != 17 {
		t.Fatalf("верхний уровень после возврата: %v", got)
	}
}

func TestMoveCategoryErrors(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := newCatUser(t, e)
	transport := u.id(t, "expense", "", "Транспорт")
	auto := u.id(t, "expense", "", "Автомобиль")
	products := u.id(t, "expense", "", "Продукты")
	taxi := u.id(t, "expense", "Транспорт", "Такси")
	salary := u.id(t, "income", "", "Зарплата")
	// Подкатегория «Подарки» у «Транспорта» — для конфликта имён на верхнем уровне.
	gifts := u.create(t, "expense", transport, "Подарки")["id"].(string)
	// «Такси» верхнего уровня — для конфликта при переносе в «Транспорт».
	topTaxi := u.create(t, "expense", nil, "Такси")["id"].(string)

	cases := []struct {
		name   string
		id     string
		parent any
		want   string
	}{
		{"в саму себя", products, products, "parentId:invalid_parent"},
		{"в подкатегорию (глубина 3)", products, taxi, "parentId:invalid_parent"},
		{"в родителя другого вида", products, salary, "parentId:invalid_parent"},
		{"доход в расход", salary, products, "parentId:invalid_parent"},
		{"несуществующий родитель", products, "0193b7c2-1f7e-7c4e-9a51-3c2d1e0f9a8b", "parentId:invalid_parent"},
		{"с подкатегориями внутрь другой", auto, transport, "parentId:has_children"},
		{"конфликт имени на верхнем уровне", gifts, nil, "parentId:name_taken"},
		{"конфликт имени у нового родителя", topTaxi, transport, "parentId:name_taken"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, body := u.send(http.MethodPost, "/categories/"+tc.id+"/move", moveBody(tc.parent, 0))
			wantFieldError(t, code, body, tc.want)
		})
	}
	// Ошибка ничего не изменила.
	if got := u.siblings(t, "expense", transport); !reflect.DeepEqual(got, []string{"Общественный транспорт", "Такси", "Подарки"}) {
		t.Fatalf("после ошибок: %v", got)
	}

	// В архивного родителя нельзя, но переставлять внутри него можно.
	health := u.id(t, "expense", "", "Здоровье")
	u.send(http.MethodPost, "/categories/"+health+"/archive", "")
	code, body := u.send(http.MethodPost, "/categories/"+products+"/move", moveBody(health, 0))
	wantFieldError(t, code, body, "parentId:invalid_parent")
	doctors := u.id(t, "expense", "Здоровье", "Врачи")
	if code, body := u.send(http.MethodPost, "/categories/"+doctors+"/move", moveBody(health, 0)); code != http.StatusOK {
		t.Fatalf("внутри архивного: %d %v", code, body)
	}

	// index < 0 и без parentId — ошибки контракта.
	code, body = u.send(http.MethodPost, "/categories/"+products+"/move", `{"parentId":null,"index":-1}`)
	wantFieldError(t, code, body, "index:too_small")
	code, body = u.send(http.MethodPost, "/categories/"+products+"/move", `{"index":0}`)
	wantFieldError(t, code, body, "parentId:required")
	code, body = u.send(http.MethodPost, "/categories/0193b7c2-1f7e-7c4e-9a51-3c2d1e0f9a8b/move", moveBody(nil, 0))
	wantNotFound(t, code, body)
}

// TestMoveCategoryConcurrent: одновременные перемещения в одной семье не дают
// дублей позиций (блокировка категорий семьи).
func TestMoveCategoryConcurrent(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := newCatUser(t, e)
	var ids []string
	for _, c := range u.list(t) {
		if c["kind"] == "expense" && c["parentId"] == nil {
			ids = append(ids, c["id"].(string))
		}
	}
	done := make(chan int, len(ids))
	for i, id := range ids {
		go func() {
			code, _ := u.send(http.MethodPost, "/categories/"+id+"/move", moveBody(nil, (i*7)%len(ids)))
			done <- code
		}()
	}
	for range ids {
		if code := <-done; code != http.StatusOK {
			t.Fatalf("перемещение: %d", code)
		}
	}
	if got := u.siblings(t, "expense", nil); len(got) != len(ids) {
		t.Fatalf("соседи: %v", got)
	}
}

func TestArchiveCategory(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := newCatUser(t, e)
	auto := u.id(t, "expense", "", "Автомобиль")
	fuel := u.id(t, "expense", "Автомобиль", "Топливо")
	parking := u.id(t, "expense", "Автомобиль", "Парковка")
	service := u.id(t, "expense", "Автомобиль", "Обслуживание")

	// «Парковка» архивирована раньше и отдельно.
	code, body := u.send(http.MethodPost, "/categories/"+parking+"/archive", "")
	if code != http.StatusOK || body["archivedAt"] == nil {
		t.Fatalf("архив подкатегории: %d %v", code, body)
	}
	parkingAt := body["archivedAt"]
	e.clock.Advance(time.Minute)

	code, body = u.send(http.MethodPost, "/categories/"+auto+"/archive", "")
	if code != http.StatusOK || body["archivedAt"] == nil {
		t.Fatalf("архив: %d %v", code, body)
	}
	autoAt := body["archivedAt"]
	if autoAt == parkingAt {
		t.Fatal("время архивации должно отличаться")
	}
	archivedAt := func(id string) any {
		for _, c := range u.list(t) {
			if c["id"] == id {
				return c["archivedAt"]
			}
		}
		t.Fatalf("нет %s", id)
		return nil
	}
	if archivedAt(fuel) != autoAt || archivedAt(service) != autoAt || archivedAt(parking) != parkingAt {
		t.Fatalf("каскад: %v %v %v", archivedAt(fuel), archivedAt(service), archivedAt(parking))
	}

	// Повторная архивация идемпотентна и время не сдвигает.
	e.clock.Advance(time.Minute)
	code, body = u.send(http.MethodPost, "/categories/"+auto+"/archive", "")
	if code != http.StatusOK || body["archivedAt"] != autoAt || archivedAt(fuel) != autoAt {
		t.Fatalf("повторный архив: %d %v", code, body)
	}

	// Разархивация родителя возвращает подкатегории с тем же archivedAt.
	code, body = u.send(http.MethodPost, "/categories/"+auto+"/unarchive", "")
	if code != http.StatusOK || body["archivedAt"] != nil {
		t.Fatalf("разархивация: %d %v", code, body)
	}
	if archivedAt(fuel) != nil || archivedAt(service) != nil || archivedAt(parking) != parkingAt {
		t.Fatalf("каскад разархивации: %v %v %v", archivedAt(fuel), archivedAt(service), archivedAt(parking))
	}
	// Повторная — идемпотентна.
	if code, body := u.send(http.MethodPost, "/categories/"+auto+"/unarchive", ""); code != http.StatusOK || body["archivedAt"] != nil {
		t.Fatalf("повторная разархивация: %d %v", code, body)
	}

	// Разархивация подкатегории архивного родителя возвращает родителя,
	// но не остальные его подкатегории.
	u.send(http.MethodPost, "/categories/"+auto+"/archive", "")
	code, body = u.send(http.MethodPost, "/categories/"+fuel+"/unarchive", "")
	if code != http.StatusOK || body["archivedAt"] != nil {
		t.Fatalf("разархивация подкатегории: %d %v", code, body)
	}
	if archivedAt(auto) != nil || archivedAt(service) == nil || archivedAt(parking) == nil {
		t.Fatalf("после разархивации подкатегории: %v %v %v", archivedAt(auto), archivedAt(service), archivedAt(parking))
	}

	for _, op := range []string{"archive", "unarchive"} {
		code, body := u.send(http.MethodPost, "/categories/0193b7c2-1f7e-7c4e-9a51-3c2d1e0f9a8b/"+op, "")
		wantNotFound(t, code, body)
	}
}

// insertTx вставляет операцию напрямую в БД (API операций ещё нет).
func insertTx(t *testing.T, u catUser, accountID, categoryID string, deleted bool) string {
	t.Helper()
	var id string
	var deletedAt *time.Time
	if deleted {
		now := time.Now()
		deletedAt = &now
	}
	if err := u.e.pool.QueryRow(context.Background(), `
		INSERT INTO transactions (family_id, kind, account_id, amount, category_id, op_date, created_by, deleted_at)
		VALUES ($1, 'expense', $2, -1000, $3, current_date, $4, $5) RETURNING id`,
		u.familyID, accountID, categoryID, u.userID, deletedAt).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func insertAccount(t *testing.T, u catUser) string {
	t.Helper()
	var id string
	if err := u.e.pool.QueryRow(context.Background(), `
		INSERT INTO accounts (family_id, name, type, currency_code) VALUES ($1, 'Наличные', 'cash', 'RUB') RETURNING id`,
		u.familyID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestMergeCategory(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := newCatUser(t, e)
	acc := insertAccount(t, u)
	auto := u.id(t, "expense", "", "Автомобиль")
	fuel := u.id(t, "expense", "Автомобиль", "Топливо")
	transport := u.id(t, "expense", "", "Транспорт")
	taxi := u.id(t, "expense", "Транспорт", "Такси")
	products := u.id(t, "expense", "", "Продукты")

	txAuto := insertTx(t, u, acc, auto, false)
	txFuel := insertTx(t, u, acc, fuel, false)
	txDeleted := insertTx(t, u, acc, fuel, true)
	txOther := insertTx(t, u, acc, products, false)

	// «Автомобиль» с подкатегориями → «Такси» (подкатегория другого родителя).
	rec := e.send(http.MethodPost, "/api/v1/categories/"+auto+"/merge", `{"targetId":"`+taxi+`"}`, withCookie(u.cookie))
	if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Fatalf("слияние: %d %s", rec.Code, rec.Body)
	}
	for _, tx := range []string{txAuto, txFuel, txDeleted} {
		var cat string
		if err := e.pool.QueryRow(context.Background(), `SELECT category_id FROM transactions WHERE id = $1`, tx).Scan(&cat); err != nil || cat != taxi {
			t.Fatalf("операция %s: категория %s, %v", tx, cat, err)
		}
	}
	if n := queryInt(t, e.pool, `SELECT count(*) FROM transactions WHERE id = $1 AND category_id = $2`, txOther, products); n != 1 {
		t.Fatal("чужая операция не должна переноситься")
	}
	if n := queryInt(t, e.pool, `SELECT count(*) FROM categories WHERE family_id = $1 AND (id = $2 OR parent_id = $2)`, u.familyID, auto); n != 0 {
		t.Fatalf("категории не удалены: %d", n)
	}
	if got := u.siblings(t, "expense", transport); !reflect.DeepEqual(got, []string{"Общественный транспорт", "Такси"}) {
		t.Fatalf("цель не тронута: %v", got)
	}

	// Журнал: одна запись delete со снимком категории и подкатегорий.
	var (
		entityType, action, actor string
		before, after             []byte
	)
	if err := e.pool.QueryRow(context.Background(), `
		SELECT entity_type, action::text, actor_user_id::text, before, after FROM audit_log
		WHERE family_id = $1 AND entity_id = $2`, u.familyID, auto).Scan(&entityType, &action, &actor, &before, &after); err != nil {
		t.Fatal(err)
	}
	if entityType != "category" || action != "delete" || actor != u.userID {
		t.Fatalf("журнал: %s %s %s", entityType, action, actor)
	}
	var snap struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Kind     string `json:"kind"`
		Children []struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			ParentID string `json:"parentId"`
		} `json:"children"`
	}
	if err := json.Unmarshal(before, &snap); err != nil {
		t.Fatal(err)
	}
	if snap.ID != auto || snap.Name != "Автомобиль" || snap.Kind != "expense" || len(snap.Children) != 3 ||
		snap.Children[0].Name != "Топливо" || snap.Children[0].ParentID != auto {
		t.Fatalf("before: %s", before)
	}
	var afterMap map[string]string
	if err := json.Unmarshal(after, &afterMap); err != nil || !reflect.DeepEqual(afterMap, map[string]string{"mergedInto": taxi}) {
		t.Fatalf("after: %s", after)
	}
	if n := queryInt(t, e.pool, `SELECT count(*) FROM audit_log WHERE family_id = $1`, u.familyID); n != 1 {
		t.Fatalf("записей в журнале: %d", n)
	}

	// Подкатегорию — в своего родителя: можно.
	if code, body := u.send(http.MethodPost, "/categories/"+taxi+"/merge", `{"targetId":"`+transport+`"}`); code != http.StatusNoContent {
		t.Fatalf("подкатегория в родителя: %d %v", code, body)
	}
	if n := queryInt(t, e.pool, `SELECT count(*) FROM transactions WHERE family_id = $1 AND category_id = $2`, u.familyID, transport); n != 3 {
		t.Fatalf("операций в «Транспорте»: %d", n)
	}
}

func TestMergeCategoryErrors(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := newCatUser(t, e)
	transport := u.id(t, "expense", "", "Транспорт")
	taxi := u.id(t, "expense", "Транспорт", "Такси")
	salary := u.id(t, "income", "", "Зарплата")
	products := u.id(t, "expense", "", "Продукты")
	health := u.id(t, "expense", "", "Здоровье")
	u.send(http.MethodPost, "/categories/"+health+"/archive", "")

	cases := []struct {
		name, id, target string
	}{
		{"в саму себя", products, products},
		{"в свою подкатегорию", transport, taxi},
		{"другой вид", products, salary},
		{"архивная цель", products, health},
		{"несуществующая цель", products, "0193b7c2-1f7e-7c4e-9a51-3c2d1e0f9a8b"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, body := u.send(http.MethodPost, "/categories/"+tc.id+"/merge", `{"targetId":"`+tc.target+`"}`)
			wantFieldError(t, code, body, "targetId:invalid_target")
		})
	}
	code, body := u.send(http.MethodPost, "/categories/0193b7c2-1f7e-7c4e-9a51-3c2d1e0f9a8b/merge", `{"targetId":"`+products+`"}`)
	wantNotFound(t, code, body)
	// Ничего не удалено.
	if n := len(u.list(t)); n != 34 {
		t.Fatalf("категорий %d", n)
	}
}

// TestCategoriesFamilyIsolation: категории чужой семьи недоступны ни одной
// операцией и не принимаются ни родителем, ни целью слияния.
func TestCategoriesFamilyIsolation(t *testing.T) {
	e := newAuthEnv(t, Options{})
	alice := newCatUser(t, e)
	bob := newCatUser(t, e)

	bobCats := map[string]bool{}
	for _, c := range bob.list(t) {
		bobCats[c["id"].(string)] = true
	}
	for _, c := range alice.list(t) {
		if bobCats[c["id"].(string)] {
			t.Fatal("в списке категория чужой семьи")
		}
	}

	aliceProducts := alice.id(t, "expense", "", "Продукты")
	bobTransport := bob.id(t, "expense", "", "Транспорт")
	bobProducts := bob.id(t, "expense", "", "Продукты")
	before := alice.list(t)

	// Чужая категория в адресе — 404 на любой операции.
	for _, r := range []struct{ method, path, body string }{
		{http.MethodPut, "/categories/" + bobProducts, `{"name":"Взлом"}`},
		{http.MethodPost, "/categories/" + bobProducts + "/move", moveBody(nil, 0)},
		{http.MethodPost, "/categories/" + bobProducts + "/archive", ""},
		{http.MethodPost, "/categories/" + bobProducts + "/unarchive", ""},
		{http.MethodPost, "/categories/" + bobProducts + "/merge", `{"targetId":"` + aliceProducts + `"}`},
	} {
		t.Run(r.method+" "+r.path[len("/categories/"+bobProducts):], func(t *testing.T) {
			code, body := alice.send(r.method, r.path, r.body)
			wantNotFound(t, code, body)
		})
	}

	// Чужая категория в теле — 422, как несуществующая.
	code, body := alice.send(http.MethodPost, "/categories", createCatBody("expense", bobTransport, "Самокат"))
	wantFieldError(t, code, body, "parentId:invalid_parent")
	code, body = alice.send(http.MethodPost, "/categories/"+aliceProducts+"/move", moveBody(bobTransport, 0))
	wantFieldError(t, code, body, "parentId:invalid_parent")
	code, body = alice.send(http.MethodPost, "/categories/"+aliceProducts+"/merge", `{"targetId":"`+bobProducts+`"}`)
	wantFieldError(t, code, body, "targetId:invalid_target")

	// Ни у Боба, ни у Алисы ничего не изменилось.
	if got := bob.find(t, "expense", "", "Продукты"); got["archivedAt"] != nil || got["sortOrder"].(float64) != 1 {
		t.Fatalf("категория Боба изменилась: %v", got)
	}
	if !reflect.DeepEqual(alice.list(t), before) {
		t.Fatal("категории Алисы изменились")
	}
	if n := queryInt(t, e.pool, `SELECT count(*) FROM categories WHERE family_id = $1`, bob.familyID); n != 34 {
		t.Fatalf("у Боба %d категорий", n)
	}
}
