package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/testdb"
)

func TestMain(m *testing.M) { testdb.Main(m) }

var discardLogger = slog.New(slog.DiscardHandler)

func newRouter(t *testing.T, logger *slog.Logger, pool *pgxpool.Pool) http.Handler {
	t.Helper()
	h, err := NewRouter(logger, pool)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

// jsonLogger пишет логи в буфер в JSON, чтобы тест мог их разобрать.
func jsonLogger() (*slog.Logger, *bytes.Buffer) {
	var buf bytes.Buffer
	return slog.New(slog.NewJSONHandler(&buf, nil)), &buf
}

// do выполняет запрос к роутеру без сетевого сервера: httptest.NewRecorder
// запоминает статус, заголовки и тело ответа.
func do(t *testing.T, h http.Handler, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
	return rec
}

// closedPool — пул, который уже закрыт: любой запрос к БД через него вернёт ошибку.
// Так проверяем поведение при отказе БД без моков.
func closedPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p, err := pgxpool.New(context.Background(), "postgres://user:secret@127.0.0.1:1/none")
	if err != nil {
		t.Fatal(err)
	}
	p.Close()
	return p
}

// decodeProblem проверяет, что ответ — problem+json с нужными статусом и кодом,
// и возвращает тело как map, чтобы проверять и точные имена полей.
func decodeProblem(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) map[string]any {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("статус %d, ожидался %d; тело: %s", rec.Code, status, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("Content-Type = %q, ожидался application/problem+json", ct)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("тело не JSON: %v; %s", err, rec.Body)
	}
	// JSON-числа декодируются в map[string]any как float64.
	if body["status"] != float64(status) || body["code"] != code || body["type"] != "about:blank" {
		t.Fatalf("неожиданное тело ошибки: %v", body)
	}
	if title, _ := body["title"].(string); title != http.StatusText(status) {
		t.Fatalf("title = %q, ожидался %q", title, http.StatusText(status))
	}
	return body
}

func TestListCurrencies(t *testing.T) {
	h := newRouter(t, discardLogger, testdb.Pool(t))
	rec := do(t, h, http.MethodGet, "/api/v1/currencies")

	if rec.Code != http.StatusOK {
		t.Fatalf("статус %d; тело: %s", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q", ct)
	}

	// Сравниваем с «сырым» JSON, а не с Go-структурой: так тест ловит и
	// переименование полей (camelCase), и лишние поля вроде isActive.
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"items": []any{
			// EUR в справочнике есть, но неактивна — в ответ не попадает.
			map[string]any{"code": "RUB", "name": "Российский рубль", "symbol": "₽", "minorUnits": float64(2)},
			map[string]any{"code": "USD", "name": "Доллар США", "symbol": "$", "minorUnits": float64(2)},
		},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ответ:\n%s\nожидалось:\n%v", rec.Body, want)
	}
}

func TestUnknownAPIRoutes(t *testing.T) {
	h := newRouter(t, discardLogger, closedPool(t))
	for _, path := range []string{"/api", "/api/", "/api/nope", "/api/v1/nope", "/api/v2/currencies"} {
		t.Run(path, func(t *testing.T) {
			decodeProblem(t, do(t, h, http.MethodGet, path), http.StatusNotFound, "not_found")
		})
	}
}

func TestMethodNotAllowed(t *testing.T) {
	h := newRouter(t, discardLogger, closedPool(t))
	rec := do(t, h, http.MethodDelete, "/api/v1/currencies")
	decodeProblem(t, rec, http.StatusMethodNotAllowed, "method_not_allowed")
	if got := rec.Header().Get("Allow"); got != "GET, HEAD" {
		t.Fatalf("Allow = %q, ожидалось \"GET, HEAD\"", got)
	}
}

// HEAD на ресурс с GET отвечает как GET (статус и заголовки).
func TestHeadOnGetResource(t *testing.T) {
	h := newRouter(t, discardLogger, testdb.Pool(t))
	for _, path := range []string{"/api/v1/currencies", "/healthz"} {
		t.Run(path, func(t *testing.T) {
			rec := do(t, h, http.MethodHead, path)
			if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/json" {
				t.Fatalf("HEAD %s: %d %q", path, rec.Code, rec.Header().Get("Content-Type"))
			}
		})
	}
}

// Клиент отменил запрос — это не сбой сервера: в логе info и статус 499, а не 500.
func TestClientCanceledIsNotError(t *testing.T) {
	logger, logBuf := jsonLogger()
	h := newRouter(t, logger, testdb.Pool(t))

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/currencies", nil).WithContext(ctx))

	if rec.Code != statusClientClosedRequest {
		t.Fatalf("статус %d, ожидался %d", rec.Code, statusClientClosedRequest)
	}
	logs := logBuf.String()
	if strings.Contains(logs, `"level":"ERROR"`) || !strings.Contains(logs, "request canceled by client") {
		t.Fatalf("отмена клиентом залогирована неверно:\n%s", logs)
	}
}

// Ошибка БД → 500 с общим текстом: подробности (адрес БД, текст ошибки драйвера)
// клиенту не уходят, но попадают в лог с request id.
func TestInternalErrorDoesNotLeakDetails(t *testing.T) {
	logger, logBuf := jsonLogger()
	h := newRouter(t, logger, closedPool(t))

	rec := do(t, h, http.MethodGet, "/api/v1/currencies")
	body := decodeProblem(t, rec, http.StatusInternalServerError, "internal")

	detail, _ := body["detail"].(string)
	if detail == "" || strings.Contains(rec.Body.String(), "closed") || strings.Contains(rec.Body.String(), "secret") {
		t.Fatalf("тело 500 раскрывает подробности или пустое: %s", rec.Body)
	}
	reqID := rec.Header().Get(requestIDHeader)
	if reqID == "" {
		t.Fatal("нет заголовка X-Request-Id")
	}
	logs := logBuf.String()
	if !strings.Contains(logs, "list active currencies") || !strings.Contains(logs, reqID) {
		t.Fatalf("в логе нет причины ошибки или request id:\n%s", logs)
	}
}

func TestPanicReturnsProblem(t *testing.T) {
	logger, logBuf := jsonLogger()
	h := requestID(requestLogger(logger)(recoverer(logger)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))))

	rec := do(t, h, http.MethodGet, "/api/v1/anything")
	decodeProblem(t, rec, http.StatusInternalServerError, "internal")
	if strings.Contains(rec.Body.String(), "boom") {
		t.Fatalf("текст паники ушёл клиенту: %s", rec.Body)
	}
	logs := logBuf.String()
	if !strings.Contains(logs, "panic in handler") || !strings.Contains(logs, `"status":500`) {
		t.Fatalf("паника или итоговый статус не попали в лог:\n%s", logs)
	}
}

func TestRequestLog(t *testing.T) {
	logger, logBuf := jsonLogger()
	h := newRouter(t, logger, closedPool(t))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/nope", nil)
	req.Header.Set(requestIDHeader, "client-id-1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get(requestIDHeader); got != "client-id-1" {
		t.Fatalf("X-Request-Id = %q, ожидался присланный клиентом", got)
	}
	var entry map[string]any
	if err := json.Unmarshal(logBuf.Bytes(), &entry); err != nil {
		t.Fatalf("ожидалась одна JSON-строка лога: %v\n%s", err, logBuf.String())
	}
	for key, want := range map[string]any{
		"msg": "http request", "method": "GET", "path": "/api/v1/nope",
		"status": float64(404), "request_id": "client-id-1",
	} {
		if entry[key] != want {
			t.Errorf("%s = %v, ожидалось %v", key, entry[key], want)
		}
	}
	if _, ok := entry["duration_ms"].(float64); !ok {
		t.Errorf("нет duration_ms: %v", entry)
	}
}

func TestRequestIDRejectsUnsafeValues(t *testing.T) {
	h := newRouter(t, discardLogger, closedPool(t))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/nope", nil)
	req.Header.Set(requestIDHeader, "bad id\nwith newline")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if got := rec.Header().Get(requestIDHeader); got == "" || strings.ContainsAny(got, " \n") {
		t.Fatalf("небезопасный X-Request-Id не заменён: %q", got)
	}
}

func TestParamErrorsBecomeValidationProblems(t *testing.T) {
	// Параметров у текущих эндпоинтов нет, поэтому проверяем обработчик напрямую.
	rec := httptest.NewRecorder()
	paramErrorHandler(rec, httptest.NewRequest(http.MethodGet, "/", nil),
		&oapi.InvalidParamFormatError{ParamName: "limit", Err: errors.New("invalid syntax")})
	body := decodeProblem(t, rec, http.StatusUnprocessableEntity, "validation_failed")
	errs, _ := body["errors"].([]any)
	if len(errs) != 1 {
		t.Fatalf("errors = %v", body["errors"])
	}
	fe, _ := errs[0].(map[string]any)
	if fe["field"] != "limit" || fe["code"] != "invalid_format" || fe["message"] == "" {
		t.Fatalf("ошибка поля = %v", fe)
	}
}

func TestRequestBodyErrorIsProblem(t *testing.T) {
	rec := httptest.NewRecorder()
	requestErrorHandler(rec, httptest.NewRequest(http.MethodPost, "/", nil), &json.SyntaxError{})
	decodeProblem(t, rec, http.StatusBadRequest, "bad_request")
}

// Ошибка типа при разборе тела strict-сервером указывает на поле.
func TestRequestBodyTypeErrorHasField(t *testing.T) {
	var dst struct {
		Split struct {
			Amount int32 `json:"amount"`
		} `json:"split"`
	}
	err := json.Unmarshal([]byte(`{"split":{"amount":"сто"}}`), &dst)

	rec := httptest.NewRecorder()
	requestErrorHandler(rec, httptest.NewRequest(http.MethodPost, "/", nil), err)
	body := decodeProblem(t, rec, http.StatusUnprocessableEntity, "validation_failed")
	errs, _ := body["errors"].([]any)
	if len(errs) != 1 || errs[0].(map[string]any)["field"] != "split.amount" {
		t.Fatalf("errors = %v", body["errors"])
	}
}

func TestHealthz(t *testing.T) {
	t.Run("БД доступна", func(t *testing.T) {
		logger, logBuf := jsonLogger()
		rec := do(t, newRouter(t, logger, testdb.Pool(t)), http.MethodGet, "/healthz")
		if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"status":"ok"}` {
			t.Fatalf("%d %s", rec.Code, rec.Body)
		}
		if logBuf.Len() != 0 {
			t.Fatalf("успешный /healthz не должен попадать в лог:\n%s", logBuf)
		}
	})
	t.Run("БД недоступна", func(t *testing.T) {
		logger, logBuf := jsonLogger()
		rec := do(t, newRouter(t, logger, closedPool(t)), http.MethodGet, "/healthz")
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("%d %s", rec.Code, rec.Body)
		}
		logs := logBuf.String()
		if !strings.Contains(logs, `"level":"WARN"`) || !strings.Contains(logs, "db ping failed") || !strings.Contains(logs, `"status":503`) {
			t.Fatalf("в логе нет предупреждения о БД или строки запроса:\n%s", logs)
		}
	})
}

// Вне /api ошибки не обязаны быть problem+json — там нет API.
func TestUnknownRouteOutsideAPI(t *testing.T) {
	rec := do(t, newRouter(t, discardLogger, closedPool(t)), http.MethodGet, "/nope")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("статус %d", rec.Code)
	}
}
