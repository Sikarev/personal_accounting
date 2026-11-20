// Package httpapi собирает HTTP-маршруты API.
package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/netip"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/mail"
	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/problem"
	"personal-accounting/api/internal/ratelimit"
)

const (
	healthzPath = "/healthz"
	// apiPrefix — servers[0].url в openapi.yaml.
	apiPrefix = "/api/v1"
)

// Options — настройки роутера. Нулевое значение годится для тестов
// и разработки: cookie без Secure, прокси не доверяем, лимиты по умолчанию.
type Options struct {
	// CookieSecure — флаг Secure у cookie сессии (в production — true).
	CookieSecure bool
	// TrustedProxies — прокси, которым доверяем X-Forwarded-For (см. clientIP).
	TrustedProxies []netip.Prefix
	// CSRFTrustedOrigins — origin, с которых разрешены кросс-доменные запросы,
	// меняющие данные, например "http://localhost:5173".
	CSRFTrustedOrigins []string
	// Now — источник времени; nil — time.Now. Тесты подменяют его, чтобы
	// проверить истечение сессий и окна лимитов без ожидания.
	Now func() time.Time
	// Limits — лимиты частоты; нулевые поля заменяются значениями по умолчанию.
	Limits Limits
	// Mail — фоновая отправка писем. nil — письма выбрасываются (для тестов,
	// которым письма не нужны); cmd/api всегда передаёт настоящую.
	Mail *mail.Background
	// AppBaseURL — адрес фронтенда без «/» в конце, из него собираются ссылки
	// в письмах. Пусто — http://localhost:5173 (dev-сервер Vite).
	AppBaseURL string
}

// Limits — ограничения частоты запросов (в памяти процесса).
type Limits struct {
	// AuthPerIP — запросы к регистрации и входу с одного IP.
	AuthPerIP ratelimit.Rule
	// LoginPerEmailIP — попытки входа в один аккаунт с одного IP (IPv6 — сеть /64).
	// Успешный вход сбрасывает счёт.
	LoginPerEmailIP ratelimit.Rule
	// LoginFailuresPerEmail — неудачные попытки входа в один аккаунт со всех
	// адресов вместе: защита от распределённого перебора. Успешный вход его не сбрасывает.
	LoginFailuresPerEmail ratelimit.Rule
	// PasswordResetPerIP — запросы письма сброса пароля с одного IP; превышение — 429.
	PasswordResetPerIP ratelimit.Rule
	// PasswordResetPerEmail — письма сброса пароля на один адрес. Превышение
	// ответ не меняет (всё равно 202), письмо просто не отправляется.
	PasswordResetPerEmail ratelimit.Rule
	// EmailTokenPerIP — запросы с токеном из письма (подтверждение e-mail
	// и новый пароль) с одного IP.
	EmailTokenPerIP ratelimit.Rule
	// ResendPerMinute и ResendPerHour — повторная отправка письма подтверждения
	// одним пользователем.
	ResendPerMinute ratelimit.Rule
	ResendPerHour   ratelimit.Rule
}

// defaultLimits — лимиты по умолчанию (docs/api.md, «Ограничение частоты»).
var defaultLimits = Limits{
	AuthPerIP:             ratelimit.Rule{Limit: 20, Window: time.Minute},
	LoginPerEmailIP:       ratelimit.Rule{Limit: 5, Window: 15 * time.Minute},
	LoginFailuresPerEmail: ratelimit.Rule{Limit: 50, Window: time.Hour},
	PasswordResetPerIP:    ratelimit.Rule{Limit: 20, Window: time.Hour},
	PasswordResetPerEmail: ratelimit.Rule{Limit: 3, Window: time.Hour},
	EmailTokenPerIP:       ratelimit.Rule{Limit: 20, Window: time.Minute},
	ResendPerMinute:       ratelimit.Rule{Limit: 1, Window: time.Minute},
	ResendPerHour:         ratelimit.Rule{Limit: 5, Window: time.Hour},
}

// Операции (operationId), к которым применяются лимиты по IP.
var (
	// authRateLimitedOps — лимит AuthPerIP.
	authRateLimitedOps = map[string]bool{"register": true, "login": true}
	// passwordResetRateLimitedOps — лимит PasswordResetPerIP.
	passwordResetRateLimitedOps = map[string]bool{"requestPasswordReset": true}
	// emailTokenRateLimitedOps — лимит EmailTokenPerIP.
	emailTokenRateLimitedOps = map[string]bool{"verifyEmail": true, "confirmPasswordReset": true}
)

func (o Options) withDefaults() Options {
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Mail == nil {
		o.Mail = mail.NewBackground(mail.Discard{}, slog.New(slog.DiscardHandler), time.Second)
	}
	if o.AppBaseURL == "" {
		o.AppBaseURL = "http://localhost:5173"
	}
	// Нулевое правило (Limit == 0) заменяется значением по умолчанию.
	for _, r := range []struct{ rule, def *ratelimit.Rule }{
		{&o.Limits.AuthPerIP, &defaultLimits.AuthPerIP},
		{&o.Limits.LoginPerEmailIP, &defaultLimits.LoginPerEmailIP},
		{&o.Limits.LoginFailuresPerEmail, &defaultLimits.LoginFailuresPerEmail},
		{&o.Limits.PasswordResetPerIP, &defaultLimits.PasswordResetPerIP},
		{&o.Limits.PasswordResetPerEmail, &defaultLimits.PasswordResetPerEmail},
		{&o.Limits.EmailTokenPerIP, &defaultLimits.EmailTokenPerIP},
		{&o.Limits.ResendPerMinute, &defaultLimits.ResendPerMinute},
		{&o.Limits.ResendPerHour, &defaultLimits.ResendPerHour},
	} {
		if r.rule.Limit == 0 {
			*r.rule = *r.def
		}
	}
	return o
}

// NewRouter возвращает http.Handler со всеми маршрутами.
// Зависимости (логгер, пул БД, настройки) передаются явно — без глобальных переменных.
func NewRouter(logger *slog.Logger, db *pgxpool.Pool, opts Options) (http.Handler, error) {
	opts = opts.withDefaults()

	// Спецификация встроена в бинарник при генерации (oapi.GetSpec);
	// по ней валидатор проверяет запросы, а authenticate узнаёт,
	// какие операции публичные.
	spec, err := oapi.GetSpec()
	if err != nil {
		return nil, fmt.Errorf("загрузка встроенной спецификации: %w", err)
	}
	routes := newSpecRoutes(spec, apiPrefix)

	// Защита от CSRF из стандартной библиотеки (Go 1.25+). Запросы, меняющие
	// данные (POST, PUT, PATCH, DELETE), пропускаются, только если браузер
	// подтверждает, что они со страницы того же origin: Sec-Fetch-Site: same-origin
	// или (в старых браузерах) Origin совпадает с Host. Запросы без этих
	// заголовков (curl, серверные клиенты) не из браузера — их тоже пропускаем.
	csrf := http.NewCrossOriginProtection()
	for _, origin := range opts.CSRFTrustedOrigins {
		if err := csrf.AddTrustedOrigin(origin); err != nil {
			return nil, fmt.Errorf("CSRF_TRUSTED_ORIGINS: %w", err)
		}
	}
	csrf.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		problem.Write(w, problem.ForbiddenOrigin())
	}))

	srv := newServer(db, opts)
	authIPLimiter := ratelimit.New(opts.Limits.AuthPerIP, opts.Now)
	resetIPLimiter := ratelimit.New(opts.Limits.PasswordResetPerIP, opts.Now)
	emailTokenIPLimiter := ratelimit.New(opts.Limits.EmailTokenPerIP, opts.Now)

	r := chi.NewRouter()
	// Порядок важен:
	// - withClientInfo первым — реальный IP нужен уже логгеру;
	// - логгер оборачивает recoverer, поэтому запрос, закончившийся паникой,
	//   попадает в лог со статусом 500.
	//
	// middleware.RealIP из chi не используется: он безусловно доверяет
	// X-Forwarded-For. Свой withClientInfo верит заголовку только от
	// доверенных прокси (TRUSTED_PROXIES).
	r.Use(withClientInfo(opts.TrustedProxies))
	r.Use(requestID)
	r.Use(requestLogger(logger))
	r.Use(recoverer(logger))
	// HEAD на ресурсы с GET обрабатывается как GET без тела (RFC 9110).
	r.Use(middleware.GetHead)

	r.Get(healthzPath, healthz(logger, db))

	// Всё под /api отвечает ошибками в формате problem+json,
	// в том числе на неизвестные адреса и неподдерживаемые методы.
	r.Route("/api", func(api chi.Router) {
		api.Use(csrf.Handler)
		// NotFound/MethodNotAllowed задаём до Route("/v1"): chi копирует их
		// во вложенный роутер в момент монтирования.
		api.NotFound(notFound)
		api.MethodNotAllowed(methodNotAllowed)

		api.Route("/v1", func(v1 chi.Router) {
			// Strict-сервер сам разбирает запрос и вызывает наш метод с готовой
			// структурой; мы возвращаем типизированный ответ или ошибку.
			strict := oapi.NewStrictHandlerWithOptions(srv, nil, oapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  requestErrorHandler,
				ResponseErrorHandlerFunc: responseErrorHandler(logger),
			})
			oapi.HandlerWithOptions(strict, oapi.ChiServerOptions{
				BaseRouter:       v1,
				ErrorHandlerFunc: paramErrorHandler,
				// Сгенерированный код оборачивает обработчик по порядку списка,
				// поэтому последний элемент выполняется первым. Порядок выполнения:
				// сессия (401) → лимит частоты (429) → проверка по контракту (422) →
				// разбор запроса strict-сервером → обработчик.
				Middlewares: []oapi.MiddlewareFunc{
					requestValidator(logger, routes),
					rateLimitByIP(routes, authIPLimiter, authRateLimitedOps),
					rateLimitByIP(routes, resetIPLimiter, passwordResetRateLimitedOps),
					rateLimitByIP(routes, emailTokenIPLimiter, emailTokenRateLimitedOps),
					srv.authenticate(logger, routes),
				},
			})
		})
	})

	return r, nil
}

// healthz проверяет, что сервер жив и БД отвечает. Это служебный адрес для
// проверок доступности (Docker, балансировщик), он не входит в контракт API.
// Обработчик — замыкание: так он получает доступ к db без глобального состояния.
func healthz(logger *slog.Logger, db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		status, code := "ok", http.StatusOK
		if err := db.Ping(ctx); err != nil {
			// Причину пишем только в лог: адрес /healthz открыт всем.
			logger.LogAttrs(r.Context(), slog.LevelWarn, "healthz: db ping failed",
				slog.String("err", err.Error()),
				slog.String("request_id", middleware.GetReqID(r.Context())),
			)
			status, code = "db unavailable", http.StatusServiceUnavailable
		}
		writeJSON(w, code, map[string]string{"status": status})
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
