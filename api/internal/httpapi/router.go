// Package httpapi собирает HTTP-маршруты API.
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/db/dbgen"
	"personal-accounting/api/internal/oapi"
)

// NewRouter возвращает http.Handler со всеми маршрутами.
// Зависимости (логгер, пул БД) передаются явно — без глобальных переменных.
func NewRouter(logger *slog.Logger, db *pgxpool.Pool) http.Handler {
	r := chi.NewRouter()
	// Порядок важен: логгер оборачивает recoverer, поэтому запрос,
	// закончившийся паникой, попадает в лог со статусом 500.
	r.Use(requestID)
	r.Use(middleware.RealIP)
	r.Use(requestLogger(logger))
	r.Use(recoverer(logger))

	r.Get("/healthz", healthz(db))

	// Всё под /api отвечает ошибками в формате problem+json,
	// в том числе на неизвестные адреса и неподдерживаемые методы.
	r.Route("/api", func(api chi.Router) {
		// NotFound/MethodNotAllowed задаём до Route("/v1"): chi копирует их
		// во вложенный роутер в момент монтирования.
		api.NotFound(notFound)
		api.MethodNotAllowed(methodNotAllowed)

		// /api/v1 — servers[0].url в openapi.yaml.
		api.Route("/v1", func(v1 chi.Router) {
			// Strict-сервер сам разбирает запрос и вызывает наш метод с готовой
			// структурой; мы возвращаем типизированный ответ или ошибку.
			strict := oapi.NewStrictHandlerWithOptions(newServer(dbgen.New(db)), nil, oapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  requestErrorHandler,
				ResponseErrorHandlerFunc: responseErrorHandler(logger),
			})
			oapi.HandlerWithOptions(strict, oapi.ChiServerOptions{
				BaseRouter:       v1,
				ErrorHandlerFunc: paramErrorHandler,
			})
		})
	})

	return r
}

// healthz проверяет, что сервер жив и БД отвечает. Это служебный адрес для
// проверок доступности (Docker, балансировщик), он не входит в контракт API.
// Обработчик — замыкание: так он получает доступ к db без глобального состояния.
func healthz(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()

		status, code := "ok", http.StatusOK
		if err := db.Ping(ctx); err != nil {
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
