// Внешний тестовый пакет (migrations_test), а не migrations: testdb сам
// импортирует migrations, и внутренний тест дал бы цикл импортов.
package migrations_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/testdb"
)

func TestMain(m *testing.M) { testdb.Main(m) }

// Все миграции должны откатываться и накатываться заново без ошибок:
// так проверяется, что у каждой есть рабочий Down.
func TestUpDownUp(t *testing.T) {
	ctx := context.Background()
	pool := testdb.Pool(t) // уже с применёнными миграциями — это первый Up

	provider, err := testdb.NewMigrator(pool)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := provider.DownTo(ctx, 0); err != nil {
		t.Fatalf("down: %v", err)
	}
	if n := countObjects(t, pool); n != 0 {
		t.Fatalf("после отката всех миграций в схеме public осталось объектов: %d", n)
	}

	if _, err := provider.Up(ctx); err != nil {
		t.Fatalf("повторный up: %v", err)
	}
	if n := countObjects(t, pool); n == 0 {
		t.Fatal("после повторного up схема пуста")
	}
}

// countObjects считает таблицы и пользовательские типы в схеме public,
// кроме служебной таблицы goose. Down, который забыл удалить тип или таблицу,
// оставит здесь след.
func countObjects(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	var n int
	err := pool.QueryRow(context.Background(), `
		SELECT
		  (SELECT count(*) FROM pg_tables
		    WHERE schemaname = 'public' AND tablename <> 'goose_db_version')
		+ (SELECT count(*) FROM pg_type t
		    JOIN pg_namespace ns ON ns.oid = t.typnamespace
		    WHERE ns.nspname = 'public' AND t.typtype = 'e')`).Scan(&n)
	if err != nil {
		t.Fatal(err)
	}
	return n
}
