package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"testing"
)

// addOwner — участник семьи owner с ролью owner (второй владелец).
func (e authEnv) addOwner(t *testing.T, owner accUser) accUser {
	t.Helper()
	u := e.addMember(t, owner)
	if _, err := e.pool.Exec(context.Background(),
		`UPDATE family_members SET role = 'owner' WHERE user_id = $1`, u.id); err != nil {
		t.Fatal(err)
	}
	return u
}

// members — участники из GET /family/members: пары «id:роль» в порядке ответа.
func (e authEnv) members(t *testing.T, u accUser) []string {
	t.Helper()
	rec := e.as(u, http.MethodGet, "/family/members", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("участники: %d %s", rec.Code, rec.Body)
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
	out := make([]string, 0, len(body.Items))
	for _, it := range body.Items {
		out = append(out, it["userId"].(string)+":"+it["role"].(string))
	}
	return out
}

func roleBody(role string) string { return `{"role":"` + role + `"}` }

// memberAudit — записи журнала о составе семьи по пользователю userID.
func (e authEnv) memberAudit(t *testing.T, familyID, userID string) []auditEntry {
	t.Helper()
	rows, err := e.pool.Query(context.Background(), `
		SELECT actor_user_id::text, action::text, before, after FROM audit_log
		WHERE family_id = $1 AND entity_type = 'family_member' AND entity_id = $2
		ORDER BY id`, familyID, userID)
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

func snap(userID, role string) map[string]any {
	return map[string]any{"userId": userID, "role": role}
}

func TestListFamilyMembers(t *testing.T) {
	e := newAuthEnv(t, Options{})
	owner := e.newUser(t)
	m1 := e.addMember(t, owner)
	m2 := e.addMember(t, owner)
	stranger := e.newUser(t)

	// Участник видит всех, с именем и e-mail.
	rec := e.as(m1, http.MethodGet, "/family/members", "")
	if rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}
	items := decodeJSON(t, rec)["items"].([]any)
	first := items[0].(map[string]any)
	if len(items) != 3 || first["userId"] != owner.id || first["role"] != "owner" || first["name"] != "Иван" ||
		!strings.HasSuffix(first["email"].(string), "@example.com") || first["joinedAt"] == nil || len(first) != 5 {
		t.Fatalf("участники: %s", rec.Body)
	}

	// Владельцы первыми: m2 становится владельцем и встаёт перед m1.
	if rec := e.as(owner, http.MethodPut, "/family/members/"+m2.id+"/role", roleBody("owner")); rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}
	want := []string{owner.id + ":owner", m2.id + ":owner", m1.id + ":member"}
	if got := e.members(t, m1); !reflect.DeepEqual(got, want) {
		t.Fatalf("порядок: %v, ожидалось %v", got, want)
	}
	// Другая семья видит только себя.
	if got := e.members(t, stranger); !reflect.DeepEqual(got, []string{stranger.id + ":owner"}) {
		t.Fatalf("чужая семья: %v", got)
	}
}

func TestSetFamilyMemberRole(t *testing.T) {
	e := newAuthEnv(t, Options{})
	owner := e.newUser(t)
	member := e.addMember(t, owner)
	stranger := e.newUser(t)
	path := func(id string) string { return "/family/members/" + id + "/role" }

	// Не владелец — 403, и себя повысить тоже нельзя.
	decodeProblem(t, e.as(member, http.MethodPut, path(owner.id), roleBody("member")), http.StatusForbidden, "not_owner")
	decodeProblem(t, e.as(member, http.MethodPut, path(member.id), roleBody("owner")), http.StatusForbidden, "not_owner")
	// Единственный владелец не может понизить себя.
	decodeProblem(t, e.as(owner, http.MethodPut, path(owner.id), roleBody("member")), http.StatusConflict, "last_owner")
	// Чужой и несуществующий пользователь — 404; чужой владелец не может менять наши роли.
	decodeProblem(t, e.as(owner, http.MethodPut, path(stranger.id), roleBody("member")), http.StatusNotFound, "not_found")
	decodeProblem(t, e.as(owner, http.MethodPut, path("00000000-0000-7000-8000-000000000000"), roleBody("owner")), http.StatusNotFound, "not_found")
	decodeProblem(t, e.as(stranger, http.MethodPut, path(member.id), roleBody("owner")), http.StatusNotFound, "not_found")
	decodeProblem(t, e.as(owner, http.MethodPut, path(member.id), roleBody("admin")), http.StatusUnprocessableEntity, "validation_failed")
	if a := e.memberAudit(t, owner.familyID, owner.id); len(a) != 0 {
		t.Fatalf("журнал после отказов: %+v", a)
	}

	// Повышение.
	rec := e.as(owner, http.MethodPut, path(member.id), roleBody("owner"))
	if rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}
	if got := decodeJSON(t, rec); got["userId"] != member.id || got["role"] != "owner" || got["name"] != "Иван" {
		t.Fatalf("ответ: %v", got)
	}
	// Та же роль — 200 без записи в журнал.
	if rec := e.as(owner, http.MethodPut, path(member.id), roleBody("owner")); rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}
	a := e.memberAudit(t, owner.familyID, member.id)
	if len(a) != 1 || a[0].actor != owner.id || a[0].action != "update" ||
		!reflect.DeepEqual(a[0].before, snap(member.id, "member")) || !reflect.DeepEqual(a[0].after, snap(member.id, "owner")) {
		t.Fatalf("журнал повышения: %+v", a)
	}
	// Новый владелец видит свою роль в /me сразу (роль берётся из БД).
	if fam := decodeJSON(t, e.me(member.cookie))["family"].(map[string]any); fam["role"] != "owner" {
		t.Fatalf("/me: %v", fam)
	}

	// Понизить себя при другом владельце можно; после этого второй — последний.
	rec = e.as(owner, http.MethodPut, path(owner.id), roleBody("member"))
	if rec.Code != http.StatusOK || decodeJSON(t, rec)["role"] != "member" {
		t.Fatalf("понижение себя: %d %s", rec.Code, rec.Body)
	}
	decodeProblem(t, e.as(owner, http.MethodPut, path(member.id), roleBody("member")), http.StatusForbidden, "not_owner")
	decodeProblem(t, e.as(member, http.MethodPut, path(member.id), roleBody("member")), http.StatusConflict, "last_owner")
	if got := e.members(t, owner); !reflect.DeepEqual(got, []string{member.id + ":owner", owner.id + ":member"}) {
		t.Fatalf("участники: %v", got)
	}
}

func TestRemoveFamilyMember(t *testing.T) {
	e := newAuthEnv(t, Options{})
	owner := e.newUser(t)
	member := e.addMember(t, owner)
	owner2 := e.addOwner(t, owner)
	stranger := e.newUser(t)
	path := func(id string) string { return "/family/members/" + id }

	decodeProblem(t, e.as(member, http.MethodDelete, path(owner.id), ""), http.StatusForbidden, "not_owner")
	decodeProblem(t, e.as(owner, http.MethodDelete, path(owner.id), ""), http.StatusConflict, "cannot_remove_self")
	decodeProblem(t, e.as(owner, http.MethodDelete, path(stranger.id), ""), http.StatusNotFound, "not_found")
	decodeProblem(t, e.as(stranger, http.MethodDelete, path(member.id), ""), http.StatusNotFound, "not_found")

	// Исключение участника.
	if rec := e.as(owner, http.MethodDelete, path(member.id), ""); rec.Code != http.StatusNoContent {
		t.Fatalf("исключение: %d %s", rec.Code, rec.Body)
	}
	a := e.memberAudit(t, owner.familyID, member.id)
	if len(a) != 1 || a[0].actor != owner.id || a[0].action != "delete" ||
		!reflect.DeepEqual(a[0].before, snap(member.id, "member")) || a[0].after != nil {
		t.Fatalf("журнал исключения: %+v", a)
	}
	// Повторно — его уже нет в семье.
	decodeProblem(t, e.as(owner, http.MethodDelete, path(member.id), ""), http.StatusNotFound, "not_found")
	// Исключённый — владелец новой семьи с категориями; прежняя сессия работает.
	e.wantOwnNewFamily(t, member, owner.familyID)

	// Исключение другого владельца.
	if rec := e.as(owner, http.MethodDelete, path(owner2.id), ""); rec.Code != http.StatusNoContent {
		t.Fatalf("исключение владельца: %d %s", rec.Code, rec.Body)
	}
	e.wantOwnNewFamily(t, owner2, owner.familyID)
	if got := e.members(t, owner); !reflect.DeepEqual(got, []string{owner.id + ":owner"}) {
		t.Fatalf("осталось: %v", got)
	}
}

// wantOwnNewFamily: u больше не в семье oldFamily, у него своя семья «Семья»,
// он в ней единственный владелец, категории по умолчанию созданы.
func (e authEnv) wantOwnNewFamily(t *testing.T, u accUser, oldFamily string) string {
	t.Helper()
	rec := e.me(u.cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("/me: %d %s", rec.Code, rec.Body)
	}
	fam := decodeJSON(t, rec)["family"].(map[string]any)
	if fam["id"] == oldFamily || fam["name"] != "Семья" || fam["role"] != "owner" || fam["memberCount"] != float64(1) {
		t.Fatalf("новая семья: %v", fam)
	}
	newFamily := fam["id"].(string)
	if n := queryInt(t, e.pool, `SELECT count(*) FROM categories WHERE family_id = $1`, newFamily); n == 0 {
		t.Fatal("в новой семье нет категорий")
	}
	if got := e.members(t, u); !reflect.DeepEqual(got, []string{u.id + ":owner"}) {
		t.Fatalf("участники новой семьи: %v", got)
	}
	return newFamily
}

func TestLeaveFamily(t *testing.T) {
	e := newAuthEnv(t, Options{})

	// Единственный участник — выходить некуда.
	alone := e.newUser(t)
	decodeProblem(t, e.as(alone, http.MethodPost, "/family/leave", ""), http.StatusConflict, "sole_member")

	owner := e.newUser(t)
	member := e.addMember(t, owner)
	other := e.addMember(t, owner)

	// Последний владелец при участниках — 409.
	decodeProblem(t, e.as(owner, http.MethodPost, "/family/leave", ""), http.StatusConflict, "last_owner")

	// Участник выходит: ответ — Me с новой семьёй.
	rec := e.as(member, http.MethodPost, "/family/leave", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("выход: %d %s", rec.Code, rec.Body)
	}
	fam := decodeJSON(t, rec)["family"].(map[string]any)
	newFamily := e.wantOwnNewFamily(t, member, owner.familyID)
	if fam["id"] != newFamily || fam["role"] != "owner" {
		t.Fatalf("ответ выхода: %v", fam)
	}
	a := e.memberAudit(t, owner.familyID, member.id)
	if len(a) != 1 || a[0].actor != member.id || a[0].action != "delete" ||
		!reflect.DeepEqual(a[0].before, snap(member.id, "member")) || a[0].after != nil {
		t.Fatalf("журнал выхода: %+v", a)
	}

	// Владелец выходит, когда есть другой владелец.
	if rec := e.as(owner, http.MethodPut, "/family/members/"+other.id+"/role", roleBody("owner")); rec.Code != http.StatusOK {
		t.Fatal(rec.Body)
	}
	if rec := e.as(owner, http.MethodPost, "/family/leave", ""); rec.Code != http.StatusOK {
		t.Fatalf("выход владельца: %d %s", rec.Code, rec.Body)
	}
	e.wantOwnNewFamily(t, owner, owner.familyID)
	if got := e.members(t, other); !reflect.DeepEqual(got, []string{other.id + ":owner"}) {
		t.Fatalf("в старой семье: %v", got)
	}
	// Теперь other один — ему выходить некуда.
	decodeProblem(t, e.as(other, http.MethodPost, "/family/leave", ""), http.StatusConflict, "sole_member")
}

// После выхода или исключения личные счета ушедшего остаются в старой семье
// в архиве и не раскрываются ни одним эндпоинтом — ни оставшимся, ни ему.
func TestDepartedMemberPrivateData(t *testing.T) {
	for _, how := range []string{"leave", "remove"} {
		t.Run(how, func(t *testing.T) {
			e := newAuthEnv(t, Options{})
			owner := e.newUser(t)
			member := e.addMember(t, owner)
			food := e.catID(t, owner.familyID, "expense", "Продукты")
			shared := e.createAccount(t, owner, accountBody("Общий", "shared", 1000))["id"].(string)
			private := e.createAccount(t, member, accountBody("Личный", "private", 50000))["id"].(string)

			const day = "2026-06-10"
			privExp := e.createTxID(t, member, expenseReq(private, food, 700, day))
			toShared := e.createTxID(t, member, transferReq(private, shared, 500, day))
			fromShared := e.createTxID(t, member, transferReq(shared, private, 300, day))
			sharedByMember := e.createTxID(t, member, expenseReq(shared, food, 40, day))
			ownerExp := e.createTxID(t, owner, expenseReq(shared, food, 10, day))

			switch how {
			case "leave":
				if rec := e.as(member, http.MethodPost, "/family/leave", ""); rec.Code != http.StatusOK {
					t.Fatal(rec.Body)
				}
			case "remove":
				if rec := e.as(owner, http.MethodDelete, "/family/members/"+member.id, ""); rec.Code != http.StatusNoContent {
					t.Fatal(rec.Body)
				}
			}

			// Счёт остался в старой семье, в архиве.
			if n := queryInt(t, e.pool, `SELECT count(*) FROM accounts
				WHERE id = $1 AND family_id = $2 AND archived_at IS NOT NULL`, private, owner.familyID); n != 1 {
				t.Fatal("личный счёт не в архиве старой семьи")
			}

			// Ни один эндпоинт не упоминает личный счёт — ни у оставшегося, ни у ушедшего.
			const period = "from=" + day + "&to=" + day
			for _, u := range []accUser{owner, member} {
				for _, p := range []string{
					"/accounts", "/transactions", "/transactions?accountId=" + private, "/transactions/summary",
					"/transactions/defaults", "/reports/categories?kind=expense&" + period,
					"/reports/monthly?" + period, "/reports/balance?" + period,
				} {
					rec := e.as(u, http.MethodGet, p, "")
					if rec.Code != http.StatusOK {
						t.Fatalf("GET %s: %d %s", p, rec.Code, rec.Body)
					}
					if strings.Contains(rec.Body.String(), private) {
						t.Fatalf("GET %s раскрывает личный счёт: %s", p, rec.Body)
					}
				}
				e.expectAccountHidden(t, u, private)
				decodeProblem(t, e.as(u, http.MethodGet, "/transactions/"+privExp, ""), http.StatusNotFound, "not_found")
			}

			// Оставшийся видит общую сторону переводов и операции ушедшего на общем счёте.
			wantSameIDs(t, "лента оставшегося", e.feedIDs(t, owner, ""), []string{toShared, fromShared, sharedByMember, ownerExp})
			counterparty := map[string]any{"id": member.id, "name": "Иван"}
			for _, id := range []string{toShared, fromShared} {
				got := decodeJSON(t, e.as(owner, http.MethodGet, "/transactions/"+id, ""))
				if !reflect.DeepEqual(got["counterparty"], counterparty) || got["editable"] != false {
					t.Fatalf("перевод после ухода: %v", got)
				}
				decodeProblem(t, e.as(owner, http.MethodPut, "/transactions/"+id, expenseReq(shared, food, 1, day).json()),
					http.StatusForbidden, "transaction_readonly")
				decodeProblem(t, e.as(owner, http.MethodDelete, "/transactions/"+id, ""), http.StatusForbidden, "transaction_readonly")
			}
			if got := e.summary(t, owner, ""); !reflect.DeepEqual(got, []currencyTotal{{"RUB", 50, 0}}) {
				t.Fatalf("итоги оставшегося: %v", got)
			}
			if r := e.catReport(t, owner, "kind=expense&"+period); r.Total != 50 {
				t.Fatalf("отчёт по категориям: %+v", r)
			}
			wantPoints(t, e.balReport(t, owner, period), "day", []balancePoint{{day, 1000 + 500 - 300 - 40 - 10}})
			if b := e.balanceOf(t, owner, shared); b != 1000+500-300-40-10 {
				t.Fatalf("остаток общего счёта: %d", b)
			}

			// У ушедшего — пустая новая семья: ни счетов, ни операций старой семьи.
			if got := e.listAccounts(t, member); len(got) != 0 {
				t.Fatalf("счета ушедшего: %v", got)
			}
			if got := e.feedIDs(t, member, ""); len(got) != 0 {
				t.Fatalf("лента ушедшего: %v", got)
			}
			e.expectAccountHidden(t, member, shared)
		})
	}
}

// Гонки: изменения состава одной семьи идут под advisory-lock, роль
// действующего перечитывается под ним — семья не остаётся без владельца.
func TestFamilyOwnershipRaces(t *testing.T) {
	e := newAuthEnv(t, Options{})
	type req struct {
		u            accUser
		method, path string
		body         string
	}
	// run выполняет запросы одновременно и возвращает статусы в том же порядке.
	run := func(reqs ...req) []int {
		codes := make([]int, len(reqs))
		var wg sync.WaitGroup
		for i, r := range reqs {
			wg.Add(1)
			go func() {
				defer wg.Done()
				codes[i] = e.as(r.u, r.method, r.path, r.body).Code
			}()
		}
		wg.Wait()
		return codes
	}
	owners := func(familyID string) int {
		return queryInt(t, e.pool, `SELECT count(*) FROM family_members WHERE family_id = $1 AND role = 'owner'`, familyID)
	}
	// ok — сколько запросов прошли (2xx).
	ok := func(codes []int) int {
		n := 0
		for _, c := range codes {
			if c < 300 {
				n++
			}
		}
		return n
	}

	for range 5 {
		// Два владельца понижают друг друга: проходит ровно один, второй — уже не владелец.
		a := e.newUser(t)
		b := e.addOwner(t, a)
		codes := run(
			req{a, http.MethodPut, "/family/members/" + b.id + "/role", roleBody("member")},
			req{b, http.MethodPut, "/family/members/" + a.id + "/role", roleBody("member")},
		)
		if ok(codes) != 1 || owners(a.familyID) != 1 {
			t.Fatalf("взаимное понижение: %v, владельцев %d", codes, owners(a.familyID))
		}

		// Два владельца понижают себя.
		a = e.newUser(t)
		b = e.addOwner(t, a)
		codes = run(
			req{a, http.MethodPut, "/family/members/" + a.id + "/role", roleBody("member")},
			req{b, http.MethodPut, "/family/members/" + b.id + "/role", roleBody("member")},
		)
		if ok(codes) != 1 || owners(a.familyID) != 1 {
			t.Fatalf("понижение себя: %v, владельцев %d", codes, owners(a.familyID))
		}

		// Два владельца выходят при третьем участнике-не владельце.
		a = e.newUser(t)
		b = e.addOwner(t, a)
		e.addMember(t, a)
		codes = run(
			req{a, http.MethodPost, "/family/leave", ""},
			req{b, http.MethodPost, "/family/leave", ""},
		)
		if ok(codes) != 1 || owners(a.familyID) != 1 {
			t.Fatalf("одновременный выход: %v, владельцев %d", codes, owners(a.familyID))
		}

		// Владелец исключает второго, а тот одновременно выходит: у второго одна новая семья.
		a = e.newUser(t)
		b = e.addOwner(t, a)
		codes = run(
			req{a, http.MethodDelete, "/family/members/" + b.id, ""},
			req{b, http.MethodPost, "/family/leave", ""},
		)
		if ok(codes) != 1 || queryInt(t, e.pool, `SELECT count(*) FROM family_members WHERE user_id = $1`, b.id) != 1 {
			t.Fatalf("исключение и выход: %v", codes)
		}
	}
}
