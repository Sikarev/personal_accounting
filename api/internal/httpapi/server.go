package httpapi

import (
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/auth"
	"personal-accounting/api/internal/db/dbgen"
	"personal-accounting/api/internal/mail"
	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/ratelimit"
)

// server реализует oapi.StrictServerInterface — по методу на каждую операцию
// из openapi.yaml. Методы разложены по файлам по предметным областям
// (currencies.go, auth.go, позже accounts.go и т. д.).
type server struct {
	// pool нужен для транзакций: pool.Begin → q.WithTx(tx) → Commit
	// (паттерн — в docs/api.md). Одиночные запросы идут через q.
	pool *pgxpool.Pool
	q    *dbgen.Queries

	now          func() time.Time // источник времени; в тестах подменяется
	cookieSecure bool
	// mail — фоновая отправка писем; appBaseURL — адрес фронтенда для ссылок в них.
	mail       *mail.Background
	appBaseURL string
	// loginAttempts — попытки входа по ключу «e-mail + IP» (см. Login).
	loginAttempts *ratelimit.Limiter
	// loginFailures — неудачные попытки входа по e-mail со всех адресов.
	loginFailures *ratelimit.Limiter
	// resetPerEmail — письма сброса пароля на один адрес.
	resetPerEmail *ratelimit.Limiter
	// resendPerMinute и resendPerHour — повторные письма подтверждения
	// на одного пользователя.
	resendPerMinute *ratelimit.Limiter
	resendPerHour   *ratelimit.Limiter
	// dummyHash — хеш для проверки пароля, когда пользователя нет (см. checkPassword).
	// Считается сразу при создании сервера: если считать лениво, первый вход
	// с несуществующим e-mail был бы дольше остальных и выдавал бы это по времени.
	dummyHash string
}

// Проверка на этапе компиляции: если в контракте появилась операция,
// а метода для неё нет, сборка упадёт здесь с понятной ошибкой.
var _ oapi.StrictServerInterface = (*server)(nil)

func newServer(pool *pgxpool.Pool, opts Options) *server {
	return &server{
		pool:            pool,
		q:               dbgen.New(pool),
		now:             opts.Now,
		cookieSecure:    opts.CookieSecure,
		mail:            opts.Mail,
		appBaseURL:      opts.AppBaseURL,
		loginAttempts:   ratelimit.New(opts.Limits.LoginPerEmailIP, opts.Now),
		loginFailures:   ratelimit.New(opts.Limits.LoginFailuresPerEmail, opts.Now),
		resetPerEmail:   ratelimit.New(opts.Limits.PasswordResetPerEmail, opts.Now),
		resendPerMinute: ratelimit.New(opts.Limits.ResendPerMinute, opts.Now),
		resendPerHour:   ratelimit.New(opts.Limits.ResendPerHour, opts.Now),
		dummyHash:       auth.HashPassword("dummy password for timing equalization"),
	}
}
