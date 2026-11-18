// Package testdb даёт тестам настоящую БД Postgres.
//
// Каждый тестовый пакет (а значит, каждый тестовый процесс: go test собирает
// отдельный бинарник на пакет и запускает их параллельно) получает свою временную
// БД со случайным именем на сервере из TEST_DATABASE_URL. В неё применяются
// встроенные миграции, а после тестов пакета она удаляется. Поэтому пакеты не
// мешают друг другу и могут идти параллельно.
//
// Использование в пакете:
//
//	func TestMain(m *testing.M) { testdb.Main(m) }
//
//	func TestSomething(t *testing.T) {
//		pool := testdb.Pool(t)
//		...
//	}
//
// БД создаётся лениво — при первом вызове Pool. Тесты пакета, которым БД
// не нужна, работают и без запущенного Postgres.
package testdb

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"personal-accounting/api/migrations"
)

// DefaultURL — Postgres из docker-compose.yml. Указывает на служебную БД,
// в которой выполняются CREATE/DROP DATABASE; сами тесты в ней ничего не создают.
const DefaultURL = "postgres://pa:pa_dev_password@localhost:5432/pa?sslmode=disable"

// Состояние на уровне пакета допустимо: оно живёт в одном тестовом процессе
// и описывает ресурс этого процесса — его временную БД.
var (
	once    sync.Once
	pool    *pgxpool.Pool
	dbName  string // непустое, если временная БД создана и её надо удалить
	adminDS string
	initErr error
)

// Main запускает тесты пакета и удаляет временную БД после них.
// Вызывается из TestMain; сам завершает процесс с кодом результата тестов.
func Main(m *testing.M) {
	code := m.Run()
	if err := cleanup(); err != nil {
		fmt.Fprintf(os.Stderr, "testdb: не удалось удалить временную БД %s: %v\n", dbName, err)
		if code == 0 {
			code = 1
		}
	}
	os.Exit(code)
}

// Pool возвращает пул соединений к временной БД пакета с применёнными миграциями.
// Если Postgres недоступен, тест падает с объяснением, что запустить.
func Pool(t testing.TB) *pgxpool.Pool {
	t.Helper()
	once.Do(func() { initErr = setup() })
	if initErr != nil {
		t.Fatalf("testdb: нет тестовой БД: %v\n"+
			"Тесты работают с настоящим Postgres. Запусти его из корня репозитория: docker compose up -d\n"+
			"или укажи сервер в TEST_DATABASE_URL (сейчас: %s).", initErr, describe(adminURL()))
	}
	return pool
}

func adminURL() string {
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		return v
	}
	return DefaultURL
}

// describe — описание сервера для сообщений: только хост, порт, пользователь и БД.
// Строку подключения целиком не выводим: в ней пароль, а в форме «ключ=значение»
// (host=... password=...) url.Redacted его не скрывает.
func describe(dsn string) string {
	cfg, err := pgconn.ParseConfig(dsn)
	if err != nil {
		return "<строка подключения не разбирается>"
	}
	return fmt.Sprintf("host=%s port=%d user=%s database=%s", cfg.Host, cfg.Port, cfg.User, cfg.Database)
}

func setup() error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	adminDS = adminURL()
	admin, err := pgx.Connect(ctx, adminDS)
	if err != nil {
		return fmt.Errorf("подключение к %s: %w", describe(adminDS), err)
	}
	defer admin.Close(ctx)

	dropStale(ctx, admin, time.Now())

	name := randomName()
	// Параметры ($1) в CREATE DATABASE Postgres не поддерживает, поэтому имя
	// подставляется в текст запроса — через Sanitize, который его экранирует.
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
		return fmt.Errorf("создание БД %s: %w", name, err)
	}
	dbName = name

	cfg, err := pgxpool.ParseConfig(adminDS)
	if err != nil {
		return fmt.Errorf("разбор TEST_DATABASE_URL: %w", err)
	}
	cfg.ConnConfig.Database = dbName
	pool, err = pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return fmt.Errorf("подключение к %s: %w", dbName, err)
	}

	if err := migrateUp(ctx, pool); err != nil {
		return fmt.Errorf("миграции: %w", err)
	}
	return nil
}

// NewMigrator возвращает goose.Provider для встроенных миграций поверх пула.
// Нужен тестам, которые сами двигают схему вверх и вниз.
func NewMigrator(p *pgxpool.Pool) (*goose.Provider, error) {
	// goose работает через database/sql; stdlib.OpenDBFromPool даёт *sql.DB поверх пула pgx.
	return goose.NewProvider(goose.DialectPostgres, stdlib.OpenDBFromPool(p), migrations.FS)
}

func migrateUp(ctx context.Context, p *pgxpool.Pool) error {
	provider, err := NewMigrator(p)
	if err != nil {
		return err
	}
	_, err = provider.Up(ctx)
	return err
}

func cleanup() error {
	if dbName == "" {
		return nil // БД так и не понадобилась (или её не удалось создать)
	}
	if pool != nil {
		pool.Close()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	admin, err := pgx.Connect(ctx, adminDS)
	if err != nil {
		return err
	}
	defer admin.Close(ctx)
	// WITH (FORCE) обрывает соединения, которые тест мог не закрыть.
	_, err = admin.Exec(ctx, "DROP DATABASE IF EXISTS "+pgx.Identifier{dbName}.Sanitize()+" WITH (FORCE)")
	return err
}

const (
	namePrefix = "pa_test_"
	nameTime   = "20060102_150405" // время создания в UTC — часть имени БД
	// staleAfter — возраст, после которого временная БД считается брошенной.
	// Сутки с большим запасом длиннее любого прогона, поэтому параллельные
	// и текущие прогоны под удаление не попадают.
	staleAfter = 24 * time.Hour
)

// randomName — имя вида pa_test_20261118_153045_1a2b3c4d. Время в имени нужно,
// чтобы находить и удалять БД, оставшиеся от прерванных запусков
// (Ctrl+C, убитый процесс), — см. dropStale.
func randomName() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return namePrefix + time.Now().UTC().Format(nameTime) + "_" + hex.EncodeToString(b)
}

// dropStale удаляет временные БД старше staleAfter. Ошибки игнорируются:
// уборка — не цель теста, а несколько параллельных пакетов могут удалять
// одну и ту же брошенную БД одновременно (тогда один из DROP просто не удастся).
func dropStale(ctx context.Context, admin *pgx.Conn, now time.Time) {
	rows, err := admin.Query(ctx, `SELECT datname FROM pg_database WHERE datname LIKE 'pa\_test\_%'`)
	if err != nil {
		return
	}
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return
	}
	for _, name := range names {
		if isStale(name, now) {
			_, _ = admin.Exec(ctx, "DROP DATABASE IF EXISTS "+pgx.Identifier{name}.Sanitize()+" WITH (FORCE)")
		}
	}
}

// isStale сообщает, что БД с таким именем создана раньше now - staleAfter.
// Имена, которые не разбираются, не трогаем: это может быть чужая БД.
func isStale(name string, now time.Time) bool {
	rest, ok := strings.CutPrefix(name, namePrefix)
	if !ok || len(rest) < len(nameTime) {
		return false
	}
	created, err := time.Parse(nameTime, rest[:len(nameTime)])
	if err != nil {
		return false
	}
	return now.Sub(created) > staleAfter
}
