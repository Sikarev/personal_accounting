// Package httpapi собирает HTTP-маршруты API.
package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewRouter возвращает http.Handler со всеми маршрутами.
// Зависимости (пул БД и т. п.) передаются явно — без глобальных переменных.
func NewRouter(db *pgxpool.Pool) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer) // паника в обработчике → 500, а не падение сервера

	r.Get("/healthz", healthz(db))

	return r
}

// healthz проверяет, что сервер жив и БД отвечает.
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
