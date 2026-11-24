// Команда rates — разовая загрузка курсов ЦБ РФ тем же кодом, что и фоновая
// синхронизация в API (internal/rates).
//
//	go run ./cmd/rates sync   — догрузить недостающие курсы всех валют справочника
//
// Нужна в разработке и при первом деплое. Переменная RATES_SYNC на неё не влияет.
// При любой ошибке (ЦБ, сеть, БД) выходит с ненулевым кодом.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/config"
	"personal-accounting/api/internal/logging"
	"personal-accounting/api/internal/rates"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		slog.Error("rates failed", "err", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) != 1 || args[0] != "sync" {
		return fmt.Errorf("usage: rates sync")
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger := logging.New(os.Stdout, cfg.IsProduction())
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	started := time.Now()
	syncer := rates.NewSyncer(rates.NewClient(cfg.CBRBaseURL), db, logger, rates.Options{})
	res, err := syncer.Sync(ctx)
	logger.Info("rates: sync finished", "currencies", res.Currencies, "written", res.Written,
		"duration", time.Since(started).Round(time.Millisecond))
	return err
}
