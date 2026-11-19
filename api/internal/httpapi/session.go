package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/getkin/kin-openapi/routers"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"personal-accounting/api/internal/auth"
	"personal-accounting/api/internal/db/dbgen"
	"personal-accounting/api/internal/problem"
	"personal-accounting/api/internal/ratelimit"
)

const (
	sessionCookieName = "pa_session" // то же имя — в securitySchemes.cookieAuth контракта
	sessionCookiePath = "/api"       // cookie не уходит с запросами за статикой фронта
	// sessionTTL — срок сессии. Он скользящий: активная сессия продлевается.
	sessionTTL = 30 * 24 * time.Hour
	// sessionTouchInterval — как часто продлевать сессию. Не на каждый запрос,
	// чтобы не писать в БД при каждом обращении к API.
	sessionTouchInterval = time.Hour
)

// Principal — текущий пользователь: кто делает запрос и в какой он семье.
// family_id для запросов к доменным таблицам берётся только отсюда.
type Principal struct {
	UserID   uuid.UUID
	FamilyID uuid.UUID
	Role     dbgen.FamilyRole
}

// currentUser возвращает текущего пользователя в обработчике защищённой
// операции. Если его нет — операция в контракте помечена публичной
// (security: []), а обработчик рассчитывает на вход. Это ошибка в коде,
// а не запрос клиента, поэтому паника: recoverer ответит 500 и запишет стек.
func currentUser(ctx context.Context) Principal {
	p, ok := ctx.Value(principalKey).(Principal)
	if !ok {
		panic("currentUser: нет пользователя в контексте — операция публичная в контракте?")
	}
	return p
}

// sessionTokenFrom — токен из cookie запроса (пустой, если cookie нет).
// Нужен публичным операциям: выходу и повторному входу.
func sessionTokenFrom(ctx context.Context) string {
	tok, _ := ctx.Value(sessionTokenKey).(string)
	return tok
}

func (s *server) sessionCookie(token string, expires time.Time) *http.Cookie {
	return &http.Cookie{
		Name:    sessionCookieName,
		Value:   token,
		Path:    sessionCookiePath,
		Expires: expires,
		// Round: между расчётом expires и этой строкой проходят микросекунды,
		// без округления вышло бы 2591999 вместо 2592000.
		MaxAge:   int(expires.Sub(s.now()).Round(time.Second) / time.Second),
		HttpOnly: true, // недоступна JavaScript: XSS не украдёт сессию
		Secure:   s.cookieSecure,
		// Lax: cookie не уходит с POST-запросами с чужих сайтов, но уходит
		// при переходе по ссылке на приложение.
		SameSite: http.SameSiteLaxMode,
	}
}

// clearSessionCookie стирает cookie в браузере (Max-Age=0).
func (s *server) clearSessionCookie() *http.Cookie {
	return &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     sessionCookiePath,
		MaxAge:   -1, // в заголовке станет Max-Age=0 — «удалить сейчас»
		HttpOnly: true,
		Secure:   s.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	}
}

// isPublic сообщает, что операция в контракте не требует входа:
// у неё security: [] или среди вариантов есть пустой ({}), то есть «без авторизации».
// Если у операции нет своего security, действует глобальный.
func isPublic(route *routers.Route) bool {
	sec := route.Operation.Security
	if sec == nil {
		sec = &route.Spec.Security
	}
	if len(*sec) == 0 {
		return true
	}
	for _, req := range *sec {
		if len(req) == 0 {
			return true
		}
	}
	return false
}

// authenticate — middleware операций контракта. Кладёт токен из cookie
// в контекст, а для защищённых операций проверяет сессию и кладёт
// в контекст Principal; без действующей сессии — 401 unauthorized.
// Какие операции защищены, решает контракт (isPublic), а не список путей в коде.
func (s *server) authenticate(logger *slog.Logger, routes specRoutes) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			route, ok := routes.find(r)
			if !ok {
				// Закрываемся по умолчанию: операция, которой нет в контракте, —
				// ошибка сборки роутера, пропускать её без проверки нельзя.
				responseErrorHandler(logger)(w, r, fmt.Errorf("authenticate: операция %s %s не найдена в спецификации", r.Method, r.URL.Path))
				return
			}

			ctx := r.Context()
			var token string
			if c, err := r.Cookie(sessionCookieName); err == nil {
				token = c.Value
				ctx = context.WithValue(ctx, sessionTokenKey, token)
			}

			if !isPublic(route) {
				p, err := s.loadSession(ctx, w, token)
				if err != nil {
					responseErrorHandler(logger)(w, r, err)
					return
				}
				ctx = context.WithValue(ctx, principalKey, p)
			}
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// loadSession находит действующую сессию по токену. Продлевает её, если с
// прошлого продления прошло больше sessionTouchInterval, и тогда же
// обновляет cookie. Нет сессии — *problem.Problem 401.
func (s *server) loadSession(ctx context.Context, w http.ResponseWriter, token string) (Principal, error) {
	if token == "" {
		return Principal{}, problem.Unauthorized()
	}
	hash := auth.HashToken(token)
	row, err := s.q.GetSession(ctx, hash)
	if errors.Is(err, pgx.ErrNoRows) {
		// Сессии нет (вышли, удалили) — стираем и cookie, чтобы браузер
		// не присылал мёртвый токен.
		http.SetCookie(w, s.clearSessionCookie())
		return Principal{}, problem.Unauthorized()
	}
	if err != nil {
		return Principal{}, fmt.Errorf("get session: %w", err)
	}

	now := s.now()
	if !now.Before(row.ExpiresAt) {
		// Просроченная сессия — то же, что её отсутствие. Удаляем сразу.
		if err := s.q.DeleteSession(ctx, hash); err != nil {
			return Principal{}, fmt.Errorf("delete expired session: %w", err)
		}
		http.SetCookie(w, s.clearSessionCookie())
		return Principal{}, problem.Unauthorized()
	}

	if now.Sub(row.LastSeenAt) > sessionTouchInterval {
		expires := now.Add(sessionTTL)
		if err := s.q.TouchSession(ctx, dbgen.TouchSessionParams{Now: now, ExpiresAt: expires, TokenHash: hash}); err != nil {
			return Principal{}, fmt.Errorf("touch session: %w", err)
		}
		http.SetCookie(w, s.sessionCookie(token, expires))
	}
	return Principal{UserID: row.UserID, FamilyID: row.FamilyID, Role: row.Role}, nil
}

// operationID — operationId операции, как в openapi.yaml. oapi-codegen во
// встроенной спецификации переводит его первую букву в верхний регистр
// (по имени метода Go: register → Register), здесь возвращаем исходный вид.
func operationID(route *routers.Route) string {
	id := route.Operation.OperationID
	if id == "" {
		return ""
	}
	return strings.ToLower(id[:1]) + id[1:]
}

// rateLimitByIP ограничивает частоту запросов с одного адреса к операциям
// из ops (по operationId). Стоит до проверки по контракту: запросы
// с невалидными данными тоже расходуют лимит, иначе перебор шёл бы через них.
func rateLimitByIP(routes specRoutes, limiter *ratelimit.Limiter, ops map[string]bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if route, ok := routes.find(r); ok && ops[operationID(route)] {
				key := rateLimitKey(clientInfoFrom(r.Context()).IP)
				if retry, ok := limiter.Allow(key); !ok {
					problem.Write(w, problem.TooManyRequests(retry))
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}
