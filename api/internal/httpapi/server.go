package httpapi

import (
	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/db/dbgen"
	"personal-accounting/api/internal/oapi"
)

// server реализует oapi.StrictServerInterface — по методу на каждую операцию
// из openapi.yaml. Методы разложены по файлам по предметным областям
// (currencies.go, позже accounts.go и т. д.).
type server struct {
	// pool нужен для транзакций: pool.Begin → q.WithTx(tx) → Commit
	// (паттерн — в docs/api.md). Одиночные запросы идут через q.
	pool *pgxpool.Pool
	q    *dbgen.Queries
}

// Проверка на этапе компиляции: если в контракте появилась операция,
// а метода для неё нет, сборка упадёт здесь с понятной ошибкой.
var _ oapi.StrictServerInterface = (*server)(nil)

func newServer(pool *pgxpool.Pool) *server {
	return &server{pool: pool, q: dbgen.New(pool)}
}
