package db_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/testdb"
)

// Тесты ограничений схемы: то, что гарантирует сама БД независимо от кода приложения.

func TestMain(m *testing.M) { testdb.Main(m) }

// Коды ошибок Postgres (SQLSTATE).
const (
	foreignKeyViolation = "23503"
	checkViolation      = "23514"
)

// family — набор данных одной семьи: два счёта и категории обоих типов.
type family struct {
	id, account, account2, expenseCat, incomeCat string
}

func newFamily(t *testing.T, pool *pgxpool.Pool) family {
	t.Helper()
	ctx := context.Background()
	var f family
	mustScan(t, pool.QueryRow(ctx, `INSERT INTO families (name) VALUES ('Тестовая') RETURNING id`), &f.id)
	for _, acc := range []*string{&f.account, &f.account2} {
		mustScan(t, pool.QueryRow(ctx,
			`INSERT INTO accounts (family_id, name, type, currency_code)
			 VALUES ($1, 'Счёт', 'card', 'RUB') RETURNING id`, f.id), acc)
	}
	mustScan(t, pool.QueryRow(ctx,
		`INSERT INTO categories (family_id, kind, name) VALUES ($1, 'expense', 'Продукты') RETURNING id`, f.id), &f.expenseCat)
	mustScan(t, pool.QueryRow(ctx,
		`INSERT INTO categories (family_id, kind, name) VALUES ($1, 'income', 'Зарплата') RETURNING id`, f.id), &f.incomeCat)
	return f
}

func mustScan(t *testing.T, row interface{ Scan(...any) error }, dest ...any) {
	t.Helper()
	if err := row.Scan(dest...); err != nil {
		t.Fatal(err)
	}
}

// tx — поля вставляемой операции. nil в указателе означает NULL.
type tx struct {
	familyID    string
	kind        string
	accountID   string
	amount      int64
	toAccountID *string
	toAmount    *int64
	categoryID  *string
}

func insertTx(pool *pgxpool.Pool, x tx) error {
	_, err := pool.Exec(context.Background(),
		`INSERT INTO transactions (family_id, kind, account_id, amount, to_account_id, to_amount, category_id, op_date)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-11-18')`,
		x.familyID, x.kind, x.accountID, x.amount, x.toAccountID, x.toAmount, x.categoryID)
	return err
}

// assertViolation проверяет, что err — нарушение ограничения с нужным кодом
// (а не, например, синтаксическая ошибка в самом тесте).
func assertViolation(t *testing.T, err error, sqlState, constraint string) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("ожидалась ошибка Postgres %s, получено: %v", sqlState, err)
	}
	if pgErr.Code != sqlState {
		t.Fatalf("ожидался SQLSTATE %s, получен %s: %s", sqlState, pgErr.Code, pgErr.Message)
	}
	if constraint != "" && pgErr.ConstraintName != constraint {
		t.Fatalf("ожидалось ограничение %s, сработало %s", constraint, pgErr.ConstraintName)
	}
}

func ptr[T any](v T) *T { return &v }

// Операция семьи A не может ссылаться на счёт или категорию семьи B:
// это обеспечивают составные внешние ключи (family_id, account_id) и т. п.
func TestTransactionsCannotReferenceOtherFamily(t *testing.T) {
	pool := testdb.Pool(t)
	a, b := newFamily(t, pool), newFamily(t, pool)

	// Контроль: корректная операция в своей семье проходит, иначе
	// следующие проверки могли бы падать по другой причине.
	if err := insertTx(pool, tx{familyID: a.id, kind: "expense", accountID: a.account, amount: -100, categoryID: &a.expenseCat}); err != nil {
		t.Fatalf("корректная операция отклонена: %v", err)
	}

	cases := []struct {
		name string
		tx   tx
	}{
		{"счёт чужой семьи", tx{familyID: a.id, kind: "expense", accountID: b.account, amount: -100, categoryID: &a.expenseCat}},
		{"категория чужой семьи", tx{familyID: a.id, kind: "expense", accountID: a.account, amount: -100, categoryID: &b.expenseCat}},
		{"перевод на счёт чужой семьи", tx{familyID: a.id, kind: "transfer", accountID: a.account, amount: -100, toAccountID: &b.account, toAmount: ptr[int64](100)}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assertViolation(t, insertTx(pool, c.tx), foreignKeyViolation, "")
		})
	}
}

// Категория не может сослаться на родителя из чужой семьи.
func TestCategoryParentCannotBeFromOtherFamily(t *testing.T) {
	pool := testdb.Pool(t)
	a, b := newFamily(t, pool), newFamily(t, pool)
	_, err := pool.Exec(context.Background(),
		`INSERT INTO categories (family_id, kind, name, parent_id) VALUES ($1, 'expense', 'Кафе', $2)`,
		a.id, b.expenseCat)
	assertViolation(t, err, foreignKeyViolation, "")
}

// CHECK transactions_kind_shape: допустимые сочетания полей для каждого типа операции.
func TestTransactionKindShape(t *testing.T) {
	pool := testdb.Pool(t)
	f := newFamily(t, pool)

	valid := []struct {
		name string
		tx   tx
	}{
		{"расход", tx{kind: "expense", accountID: f.account, amount: -100, categoryID: &f.expenseCat}},
		{"доход", tx{kind: "income", accountID: f.account, amount: 100, categoryID: &f.incomeCat}},
		{"перевод", tx{kind: "transfer", accountID: f.account, amount: -100, toAccountID: &f.account2, toAmount: ptr[int64](100)}},
		{"корректировка", tx{kind: "adjustment", accountID: f.account, amount: -5}},
	}
	for _, c := range valid {
		t.Run("допустимо/"+c.name, func(t *testing.T) {
			c.tx.familyID = f.id
			if err := insertTx(pool, c.tx); err != nil {
				t.Fatalf("отклонена корректная операция: %v", err)
			}
		})
	}

	invalid := []struct {
		name string
		tx   tx
	}{
		{"расход с положительной суммой", tx{kind: "expense", accountID: f.account, amount: 100, categoryID: &f.expenseCat}},
		{"расход без категории", tx{kind: "expense", accountID: f.account, amount: -100}},
		{"доход с отрицательной суммой", tx{kind: "income", accountID: f.account, amount: -100, categoryID: &f.incomeCat}},
		{"перевод на тот же счёт", tx{kind: "transfer", accountID: f.account, amount: -100, toAccountID: &f.account, toAmount: ptr[int64](100)}},
		{"перевод с категорией", tx{kind: "transfer", accountID: f.account, amount: -100, toAccountID: &f.account2, toAmount: ptr[int64](100), categoryID: &f.expenseCat}},
		{"корректировка на ноль", tx{kind: "adjustment", accountID: f.account, amount: 0}},
		// Регрессия, исправленная миграцией 00002: «to_amount > 0» при NULL даёт NULL,
		// а CHECK пропускает NULL.
		{"перевод без суммы зачисления", tx{kind: "transfer", accountID: f.account, amount: -100, toAccountID: &f.account2}},
	}
	for _, c := range invalid {
		t.Run("отклоняется/"+c.name, func(t *testing.T) {
			c.tx.familyID = f.id
			assertViolation(t, insertTx(pool, c.tx), checkViolation, "transactions_kind_shape")
		})
	}
}
