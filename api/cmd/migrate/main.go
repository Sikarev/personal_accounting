// Команда migrate применяет миграции БД.
//
//	go run ./cmd/migrate up        — применить все новые
//	go run ./cmd/migrate down      — откатить последнюю
//	go run ./cmd/migrate status    — показать состояние
//	go run ./cmd/migrate create add_something sql — новая миграция
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib" // регистрирует драйвер "pgx" для database/sql
	"github.com/pressly/goose/v3"

	"personal-accounting/api/internal/config"
	"personal-accounting/api/migrations"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		slog.Error("migrate failed", "err", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: migrate <up|down|status|redo|reset|create NAME sql>")
	}
	command, rest := args[0], args[1:]

	// create пишет файл на диск, поэтому работает с папкой, а не со встроенными файлами.
	if command == "create" {
		goose.SetSequential(true) // имена вида 00002_name.sql, а не по времени
		return goose.RunContext(context.Background(), command, nil, "migrations", rest...)
	}

	db, err := sql.Open("pgx", config.Load().DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.RunContext(context.Background(), command, db, ".", rest...)
}
