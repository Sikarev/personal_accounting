// Package httpapi собирает HTTP-маршруты API.
package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/oapi"
)

const (
	healthzPath = "/healthz"
	// apiPrefix — servers[0].url в openapi.yaml.
	apiPrefix = "/api/v1"
)

// NewRouter возвращает http.Handler со всеми маршрутами.
// Зависимости (логгер, пул БД) передаются явно — без глобальных переменных.
func NewRouter(logger *slog.Logger, db *pgxpool.Pool) (http.Handler, error) {
	// Спецификация встроена в бинарник при генерации (oapi.GetSpec);
	// по ней валидатор проверяет запросы.
	spec, err := oapi.GetSpec()
	if err != nil {
		return nil, fmt.Errorf("загрузка встроенной спецификации: %w", err)
	}

	r := chi.NewRouter()
	// Порядок важен: логгер оборачивает recoverer, поэтому запрос,
	// закончившийся паникой, попадает в лог со статусом 500.
	//
	// middleware.RealIP намеренно не используется: он безусловно доверяет
	// X-Forwarded-For, и клиент мог бы подменить свой IP. Вернётся на этапе 1
	// вместе с ограничением частоты запросов и списком доверенных прокси.
	r.Use(requestID)
	r.Use(requestLogger(logger))
	r.Use(recoverer(logger))
	// HEAD на ресурсы с GET обрабатывается как GET без тела (RFC 9110).
	r.Use(middleware.GetHead)

	r.Get(healthzPath, healthz(logger, db))

	// Всё под /api отвечает ошибками в формате problem+json,
	// в том числе на неизвестные адреса и неподдерживаемые методы.
	r.Route("/api", func(api chi.Router) {
		// NotFound/MethodNotAllowed задаём до Route("/v1"): chi копирует их
		// во вложенный роутер в момент монтирования.
		api.NotFound(notFound)
		api.MethodNotAllowed(methodNotAllowed)

		api.Route("/v1", func(v1 chi.Router) {
			// Strict-сервер сам разбирает запрос и вызывает наш метод с готовой
			// структурой; мы возвращаем типизированный ответ или ошибку.
			strict := oapi.NewStrictHandlerWithOptions(newServer(db), nil, oapi.StrictHTTPServerOptions{
				RequestErrorHandlerFunc:  requestErrorHandler,
				ResponseErrorHandlerFunc: responseErrorHandler(logger),
			})
			oapi.HandlerWithOptions(strict, oapi.ChiServerOptions{
				BaseRouter:       v1,
				ErrorHandlerFunc: paramErrorHandler,
				// Проверка по контракту — до разбора запроса strict-сервером.
				Middlewares: []oapi.MiddlewareFunc{requestValidator(logger, spec, apiPrefix)},
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
