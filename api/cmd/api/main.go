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
	"personal-accounting/api/internal/mail"
	"personal-accounting/api/internal/rates"
)

const (
	// mailSendTimeout — предел на отправку одного письма (соединение, TLS, передача).
	mailSendTimeout = 30 * time.Second
	// shutdownTimeout — сколько ждать текущие запросы при остановке;
	// столько же потом ждём письма, отправка которых уже началась.
	shutdownTimeout = 10 * time.Second
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

	mailer := mail.NewBackground(mail.SMTP{
		Host:     cfg.SMTP.Host,
		Port:     cfg.SMTP.Port,
		Username: cfg.SMTP.Username,
		Password: cfg.SMTP.Password,
		From:     cfg.MailFrom,
	}, logger, mailSendTimeout)

	// Курсы ЦБ загружаются в фоне: при старте догружается недостающее, затем
	// раз в rates.DefaultInterval. Ошибки — в лог, API от них не зависит.
	// ratesDone закрывается, когда цикл вышел (после отмены ctx).
	ratesDone := make(chan struct{})
	if cfg.RatesSync {
		syncer := rates.NewSyncer(rates.NewClient(cfg.CBRBaseURL), db, logger, rates.Options{})
		go func() {
			defer close(ratesDone)
			syncer.Run(ctx, rates.DefaultInterval)
		}()
	} else {
		close(ratesDone)
		logger.Info("rates: sync disabled (RATES_SYNC=false)")
	}

	router, err := httpapi.NewRouter(logger, db, httpapi.Options{
		CookieSecure:       cfg.CookieSecure,
		TrustedProxies:     cfg.TrustedProxies,
		CSRFTrustedOrigins: cfg.CSRFTrustedOrigins,
		Mail:               mailer,
		AppBaseURL:         cfg.AppBaseURL,
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
			"cookie_secure", cfg.CookieSecure, "trusted_proxies", len(cfg.TrustedProxies),
			"smtp", cfg.SMTP.Host+":"+cfg.SMTP.Port, "app_base_url", cfg.AppBaseURL)
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

	// Даём текущим запросам до shutdownTimeout на завершение.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	shutdownErr := srv.Shutdown(shutdownCtx)

	// Закрываем отправку: если Shutdown вышел по таймауту, обработчики ещё
	// могут работать, и их письма уже не начнутся (будет предупреждение в логе).
	// Затем дожидаемся писем, отправка которых уже началась (очереди нет —
	// иначе они бы потерялись), но не дольше shutdownTimeout: зависший
	// SMTP-сервер не должен держать остановку.
	mailer.Close()
	mailCtx, cancelMail := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancelMail()
	if err := mailer.Wait(mailCtx); err != nil {
		logger.Warn("shutdown: не все письма отправлены", "err", err)
	}

	// Синхронизация курсов видит отменённый ctx и прерывает запросы к ЦБ и БД;
	// ждём её выхода, чтобы не закрыть пул БД (defer db.Close) под ней.
	select {
	case <-ratesDone:
	case <-time.After(shutdownTimeout):
		logger.Warn("shutdown: синхронизация курсов не остановилась вовремя")
	}
	return shutdownErr
}
