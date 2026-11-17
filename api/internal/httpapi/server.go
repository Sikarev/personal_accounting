package httpapi

import (
	"personal-accounting/api/internal/db/dbgen"
	"personal-accounting/api/internal/oapi"
)

// server реализует oapi.StrictServerInterface — по методу на каждую операцию
// из openapi.yaml. Методы разложены по файлам по предметным областям
// (currencies.go, позже accounts.go и т. д.).
type server struct {
	q dbgen.Querier
}

// Проверка на этапе компиляции: если в контракте появилась операция,
// а метода для неё нет, сборка упадёт здесь с понятной ошибкой.
var _ oapi.StrictServerInterface = (*server)(nil)

func newServer(q dbgen.Querier) *server {
	return &server{q: q}
}
