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
	// Встраивает базу часовых поясов IANA в бинарник: time.LoadLocation
	// работает и на Windows, и в минимальном контейнере без /usr/share/zoneinfo.
	_ "time/tzdata"

	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/config"
	"personal-accounting/api/internal/httpapi"
	"personal-accounting/api/internal/logging"
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
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	// Логгер передаём в роутер явно. slog.SetDefault нужен для того, что пишет
	// в лог без явного логгера (в т. ч. ошибки в main выше) — формат будет тем же.
	logger := logging.New(os.Stdout, cfg.IsProduction())
	slog.SetDefault(logger)

	// ctx отменится по Ctrl+C или SIGTERM (так останавливает контейнер Docker).
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer db.Close()

	router, err := httpapi.NewRouter(logger, db, httpapi.Options{
		CookieSecure:       cfg.CookieSecure,
		TrustedProxies:     cfg.TrustedProxies,
		CSRFTrustedOrigins: cfg.CSRFTrustedOrigins,
	})
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	// ListenAndServe блокирует выполнение, поэтому запускаем его в горутине,
	// а ошибку передаём через канал.
	errCh := make(chan error, 1)
	go func() {
		logger.Info("api listening", "addr", cfg.Addr, "env", cfg.Env,
			"cookie_secure", cfg.CookieSecure, "trusted_proxies", len(cfg.TrustedProxies))
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		logger.Info("shutting down")
	}

	// Даём текущим запросам до 10 секунд на завершение.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
