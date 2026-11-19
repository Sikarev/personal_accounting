package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"net/netip"
	"regexp"
	"runtime/debug"
	"time"

	"github.com/go-chi/chi/v5/middleware"

	"personal-accounting/api/internal/problem"
)

// requestIDHeader — заголовок с идентификатором запроса. Его можно прислать
// (например, его выставит обратный прокси), иначе сервер сгенерирует свой.
// Сервер возвращает его в ответе: по нему ошибку пользователя легко найти в логах.
const requestIDHeader = "X-Request-Id"

// Принимаем только короткие безопасные идентификаторы: значение попадает в логи.
var validRequestID = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

// requestID кладёт идентификатор запроса в контекст. Используем свой вместо
// chi middleware.RequestID: тот включает в id имя хоста, а id уходит клиенту.
// Ключ контекста — тот же, что у chi, поэтому middleware.GetReqID работает.
func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get(requestIDHeader)
		if !validRequestID.MatchString(id) {
			id = newRequestID()
		}
		w.Header().Set(requestIDHeader, id)
		ctx := context.WithValue(r.Context(), middleware.RequestIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func newRequestID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b) // crypto/rand.Read не возвращает ошибок (гарантия Go 1.24+)
	return hex.EncodeToString(b)
}

// requestLogger пишет одну строку лога на каждый запрос: метод, путь, статус,
// длительность и request id.
func requestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			// Обёртка над ResponseWriter запоминает статус, который записал обработчик.
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)

			status := ww.Status()
			if status == 0 { // обработчик ничего не записал — net/http отдаст 200
				status = http.StatusOK
			}
			// Успешные проверки доступности идут каждые несколько секунд
			// и только засоряют лог; неуспешные пишем.
			if r.URL.Path == healthzPath && status == http.StatusOK {
				return
			}
			level := slog.LevelInfo
			if status >= http.StatusInternalServerError {
				level = slog.LevelError
			}
			logger.LogAttrs(r.Context(), level, "http request",
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", status),
				slog.Float64("duration_ms", float64(time.Since(start).Microseconds())/1000),
				slog.String("request_id", middleware.GetReqID(r.Context())),
				slog.String("ip", ipString(clientInfoFrom(r.Context()).IP)),
			)
		})
	}
}

func ipString(a netip.Addr) string {
	if !a.IsValid() {
		return ""
	}
	return a.String()
}

// recoverer перехватывает панику в обработчике: пишет её со стеком в лог
// и отвечает клиенту 500 в формате problem+json, а не роняет сервер.
func recoverer(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// defer + recover — способ Go «поймать» панику, аналог catch.
			defer func() {
				rec := recover()
				if rec == nil {
					return
				}
				// ErrAbortHandler — штатный способ прервать ответ; net/http обработает его сам.
				if rec == http.ErrAbortHandler {
					panic(rec)
				}
				logger.LogAttrs(r.Context(), slog.LevelError, "panic in handler",
					slog.Any("panic", rec),
					slog.String("stack", string(debug.Stack())),
					slog.String("method", r.Method),
					slog.String("path", r.URL.Path),
					slog.String("request_id", middleware.GetReqID(r.Context())),
				)
				problem.Write(w, problem.Internal())
			}()
			next.ServeHTTP(w, r)
		})
	}
}
