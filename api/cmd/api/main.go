// Команда api — HTTP-сервер приложения.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/config"
	"personal-accounting/api/internal/httpapi"
)

func main() {
	// В Go принято, чтобы main только вызывал run и обрабатывал ошибку:
	// так логику проще тестировать, а выход из программы — в одном месте.
	if err := run(); err != nil {
		slog.Error("api stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg := config.Load()

	// ctx отменится по Ctrl+C или SIGTERM (так останавливает контейнер Docker).
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           httpapi.NewRouter(db),
		ReadHeaderTimeout: 5 * time.Second,
	}

	// ListenAndServe блокирует выполнение, поэтому запускаем его в горутине,
	// а ошибку передаём через канал.
	errCh := make(chan error, 1)
	go func() {
		slog.Info("api listening", "addr", cfg.Addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		slog.Info("shutting down")
	}

	// Даём текущим запросам до 10 секунд на завершение.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
