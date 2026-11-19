package httpapi

import (
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/auth"
	"personal-accounting/api/internal/db/dbgen"
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
	// loginAttempts — попытки входа по e-mail (лимит неудачных попыток).
	loginAttempts *ratelimit.Limiter
	// dummyHash — хеш для проверки пароля, когда пользователя нет (см. checkPassword).
	// sync.OnceValue считает его один раз при первом вызове, а не при старте.
	dummyHash func() string
}

// Проверка на этапе компиляции: если в контракте появилась операция,
// а метода для неё нет, сборка упадёт здесь с понятной ошибкой.
var _ oapi.StrictServerInterface = (*server)(nil)

func newServer(pool *pgxpool.Pool, opts Options) *server {
	return &server{
		pool:          pool,
		q:             dbgen.New(pool),
		now:           opts.Now,
		cookieSecure:  opts.CookieSecure,
		loginAttempts: ratelimit.New(opts.Limits.LoginPerEmail, opts.Now),
		dummyHash: sync.OnceValue(func() string {
			return auth.HashPassword("dummy password for timing equalization")
		}),
	}
}
