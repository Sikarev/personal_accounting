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
//
// Тест сносит всю схему временной БД пакета, поэтому он должен оставаться
// единственным тестом с БД в этом пакете: другой тест, запущенный параллельно
// или после него, увидел бы пустую или пересозданную схему. Новые тесты схемы
// пиши в internal/db — там своя БД.
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

// countObjects считает объекты схемы public, кроме служебных объектов goose:
// отношения из pg_class (таблицы, индексы, последовательности, представления),
// функции и процедуры из pg_proc и самостоятельные типы из pg_type (enum,
// домены; типы строк таблиц и массивов не считаются — они уходят вместе
// с исходным объектом). Down, который что-то забыл удалить, оставит здесь след.
func countObjects(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	var n int
	err := pool.QueryRow(context.Background(), `
		SELECT
		  (SELECT count(*) FROM pg_class c
		    WHERE c.relnamespace = 'public'::regnamespace
		      AND c.relname NOT LIKE 'goose\_db\_version%')
		+ (SELECT count(*) FROM pg_proc p
		    WHERE p.pronamespace = 'public'::regnamespace)
		+ (SELECT count(*) FROM pg_type ty
		    WHERE ty.typnamespace = 'public'::regnamespace
		      AND ty.typrelid = 0 AND ty.typcategory <> 'A')`).Scan(&n)
	if err != nil {
		t.Fatal(err)
	}
	return n
}
