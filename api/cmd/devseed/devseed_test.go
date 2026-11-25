package main

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"personal-accounting/api/internal/httpapi"
	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/testdb"
)

func TestMain(m *testing.M) { testdb.Main(m) }

func TestParseFlags(t *testing.T) {
	o, err := parseFlags(nil)
	if err != nil {
		t.Fatal(err)
	}
	if o.api != "http://localhost:8080" || o.ops != defaultOps || o.seed != defaultSeed || o.cleanup {
		t.Errorf("умолчания: %+v", o)
	}
	o, err = parseFlags([]string{"-api", "http://localhost:8091", "-ops", "5000", "-seed", "7", "-cleanup"})
	if err != nil {
		t.Fatal(err)
	}
	if o.api != "http://localhost:8091" || o.ops != 5000 || o.seed != 7 || !o.cleanup {
		t.Errorf("флаги: %+v", o)
	}
	for _, args := range [][]string{
		{"-ops", "-1"}, {"-ops", "1000000"}, {"-api", "localhost:8080"}, {"-api", "ftp://x"}, {"лишнее"},
	} {
		if _, err := parseFlags(args); err == nil {
			t.Errorf("%v: ждали ошибку", args)
		}
	}
}

func TestBuildPlanDeterministic(t *testing.T) {
	today := time.Date(2026, 11, 25, 0, 0, 0, 0, time.UTC)
	a := buildPlan(1, today, 300)
	if !reflect.DeepEqual(a, buildPlan(1, today, 300)) {
		t.Error("одно зерно — разные планы")
	}
	if reflect.DeepEqual(a, buildPlan(2, today, 300)) {
		t.Error("разные зёрна — одинаковые планы")
	}
	if len(a) != 300 {
		t.Errorf("операций %d, ждали 300", len(a))
	}
	start := today.AddDate(0, 0, -historyDays)
	for _, s := range a {
		if s.date.After(today) || s.date.Before(start) {
			t.Errorf("дата %s вне истории", s.date.Format(time.DateOnly))
		}
	}
}

// TestSeedAndCleanup — полный прогон против настоящего API (httptest) и БД:
// seed создаёт данные через HTTP, cleanup удаляет только их.
func TestSeedAndCleanup(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	router, err := httpapi.NewRouter(slog.New(slog.DiscardHandler), pool, httpapi.Options{})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(router)
	defer srv.Close()

	// Чужой пользователь с личным счётом и операцией — должен пережить cleanup.
	// Адрес похож на devseed, но под шаблон не подходит.
	other, err := newAPIClient(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if err := other.do(ctx, http.MethodPost, "/auth/register", oapi.RegisterRequest{
		AcceptTerms: oapi.True, Email: "devseed@example.com", Name: "Чужой",
		Password: password, Timezone: timezone,
	}, nil); err != nil {
		t.Fatal(err)
	}
	otherAcc, err := createAccount(ctx, other, accountSpec{"x", "Чужая карта", oapi.Card, "RUB", oapi.Private, 1000, oapi.Blue})
	if err != nil {
		t.Fatal(err)
	}
	cats, err := listCategories(ctx, other)
	if err != nil {
		t.Fatal(err)
	}
	req, err := toRequest(txSpec{kind: oapi.TransactionInputKindExpense, account: "x", amount: 100,
		category: "expense/Продукты", date: time.Now()}, map[string]openapi_types.UUID{"x": otherAcc}, cats)
	if err != nil {
		t.Fatal(err)
	}
	if err := other.do(ctx, http.MethodPost, "/transactions", req, nil); err != nil {
		t.Fatal(err)
	}

	var out strings.Builder
	res, err := seed(ctx, pool, options{api: srv.URL, ops: 60, seed: 1}, &out)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "cmd/rates sync") {
		t.Errorf("нет подсказки про курсы: %q", out.String())
	}

	// Владелец видит все счета, кроме личного участника; операции — по API.
	var me struct {
		Family struct {
			ID string `json:"id"`
		} `json:"family"`
	}
	owner, _ := newAPIClient(srv.URL)
	if err := owner.do(ctx, http.MethodPost, "/auth/login",
		oapi.LoginRequest{Email: res.ownerEmail, Password: password}, nil); err != nil {
		t.Fatal(err)
	}
	if err := owner.do(ctx, http.MethodGet, "/me", nil, &me); err != nil || me.Family.ID != res.familyID {
		t.Fatalf("/me: %v, семья %q ≠ %q", err, me.Family.ID, res.familyID)
	}
	var accounts struct {
		Items []oapi.Account `json:"items"`
	}
	if err := owner.do(ctx, http.MethodGet, "/accounts", nil, &accounts); err != nil {
		t.Fatal(err)
	}
	if len(accounts.Items) != len(ownerAccounts) {
		t.Errorf("счетов у владельца %d, ждали %d", len(accounts.Items), len(ownerAccounts))
	}

	counts := func() (users, families, txs, deleted int) {
		t.Helper()
		err := pool.QueryRow(ctx, `
			SELECT (SELECT count(*) FROM users),
			       (SELECT count(*) FROM families),
			       (SELECT count(*) FROM transactions WHERE deleted_at IS NULL),
			       (SELECT count(*) FROM transactions WHERE deleted_at IS NOT NULL)`).
			Scan(&users, &families, &txs, &deleted)
		if err != nil {
			t.Fatal(err)
		}
		return
	}
	users, families, txs, deleted := counts()
	// 1 операция чужого пользователя + созданные devseed; удалённая — одна.
	if users != 3 || families != 2 || txs != 1+res.transactions || deleted != 1 {
		t.Errorf("после seed: users=%d families=%d txs=%d (ждали %d) deleted=%d",
			users, families, txs, 1+res.transactions, deleted)
	}
	var role string
	if err := pool.QueryRow(ctx, `
		SELECT m.role FROM family_members m JOIN users u ON u.id = m.user_id
		WHERE u.email = $1 AND m.family_id = $2`, res.memberEmail, res.familyID).Scan(&role); err != nil || role != "member" {
		t.Errorf("участник: роль %q, %v", role, err)
	}

	r, err := cleanup(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if r.users != 2 || r.families != 1 || r.skipped != 0 {
		t.Errorf("cleanup: %+v", r)
	}
	if users, families, txs, _ := counts(); users != 1 || families != 1 || txs != 1 {
		t.Errorf("после cleanup: users=%d families=%d txs=%d, ждали 1/1/1", users, families, txs)
	}
	assertOtherIntact(t, pool, otherAcc.String())
}

// TestCleanupKeepsMixedFamily: devseed-пользователь в чужой семье (так будет
// после приглашений) не удаляется вместе с ней.
func TestCleanupKeepsMixedFamily(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t)
	var familyID string
	err := pool.QueryRow(ctx, `
		WITH f AS (INSERT INTO families (name) VALUES ('Чужая') RETURNING id),
		     u AS (INSERT INTO users (email, name) VALUES ('mixed-owner@example.com', 'Чужой'),
		                                                  ('devseed-mixed@example.com', 'Гость') RETURNING id, email),
		     m AS (INSERT INTO family_members (family_id, user_id, role)
		           SELECT f.id, u.id, CASE WHEN u.email LIKE 'devseed-%' THEN 'member' ELSE 'owner' END::family_role
		           FROM f, u)
		SELECT id FROM f`).Scan(&familyID)
	if err != nil {
		t.Fatal(err)
	}
	r, err := cleanup(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if r.families != 0 || r.users != 0 || r.skipped != 1 {
		t.Errorf("cleanup: %+v", r)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM family_members WHERE family_id = $1`, familyID).Scan(&n); err != nil || n != 2 {
		t.Errorf("участников чужой семьи %d, %v", n, err)
	}
	// Убираем за собой: тесты пакета делят одну БД.
	if _, err := pool.Exec(ctx, `DELETE FROM families WHERE id = $1`, familyID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM users WHERE email IN ('mixed-owner@example.com', 'devseed-mixed@example.com')`); err != nil {
		t.Fatal(err)
	}
}

func assertOtherIntact(t *testing.T, pool *pgxpool.Pool, accountID string) {
	t.Helper()
	var n int
	err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM accounts a
		JOIN users u ON u.id = a.owner_user_id
		JOIN family_members m ON m.user_id = u.id AND m.family_id = a.family_id
		WHERE a.id = $1 AND u.email = 'devseed@example.com'`, accountID).Scan(&n)
	if err != nil || n != 1 {
		t.Errorf("чужой счёт и пользователь: %d, %v", n, err)
	}
}
