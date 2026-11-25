package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/problem"
)

// Все ответы с ошибками под /api проходят через функции этого файла,
// поэтому формат ошибок везде одинаковый — problem+json.

// statusClientClosedRequest — нестандартный статус (так его называет nginx) для
// запросов, которые клиент отменил сам. Клиент его уже не увидит; он нужен,
// чтобы такие запросы в логе не выглядели как 500.
const statusClientClosedRequest = 499

func notFound(w http.ResponseWriter, _ *http.Request) {
	problem.Write(w, problem.NotFound("Адрес не найден."))
}

// Методы, которые проверяем при сборке заголовка Allow.
var allowCandidates = []string{
	http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete,
}

// methodNotAllowed отвечает 405 с заголовком Allow (его требует RFC 9110).
// Свой обработчик 405 в chi не получает список методов, поэтому спрашиваем
// у дерева маршрутов, какие методы есть для этого пути.
func methodNotAllowed(w http.ResponseWriter, r *http.Request) {
	if rctx := chi.RouteContext(r.Context()); rctx != nil && rctx.Routes != nil {
		path := r.URL.RawPath
		if path == "" {
			path = r.URL.Path
		}
		var allowed []string
		for _, m := range allowCandidates {
			// Match меняет переданный контекст, поэтому каждый раз — новый.
			if rctx.Routes.Match(chi.NewRouteContext(), m, path) {
				allowed = append(allowed, m)
				if m == http.MethodGet {
					allowed = append(allowed, http.MethodHead) // HEAD обслуживает middleware.GetHead
				}
			}
		}
		if len(allowed) > 0 {
			w.Header().Set("Allow", strings.Join(allowed, ", "))
		}
	}
	problem.Write(w, problem.MethodNotAllowed())
}

// paramErrorHandler обрабатывает ошибки разбора параметров пути, query
// и заголовков (их возвращает сгенерированная обёртка oapi-codegen).
// Обычно такие ошибки раньше ловит валидатор контракта; этот обработчик —
// страховка на случай расхождений.
func paramErrorHandler(w http.ResponseWriter, _ *http.Request, err error) {
	problem.Write(w, paramProblem(err))
}

func paramProblem(err error) *problem.Problem {
	// errors.As проверяет, есть ли в цепочке ошибка нужного типа, и достаёт её.
	var (
		required    *oapi.RequiredParamError
		requiredHdr *oapi.RequiredHeaderError
		invalid     *oapi.InvalidParamFormatError
		unmarshal   *oapi.UnmarshalingParamError
		tooMany     *oapi.TooManyValuesForParamError
	)
	switch {
	case errors.As(err, &required):
		return problem.Validation(problem.FieldError{Field: required.ParamName, Code: "required", Message: "Обязательный параметр."})
	case errors.As(err, &requiredHdr):
		return problem.Validation(problem.FieldError{Field: requiredHdr.ParamName, Code: "required", Message: "Обязательный заголовок."})
	case errors.As(err, &invalid):
		return problem.Validation(problem.FieldError{Field: invalid.ParamName, Code: "invalid_format", Message: "Некорректный формат параметра."})
	case errors.As(err, &unmarshal):
		return problem.Validation(problem.FieldError{Field: unmarshal.ParamName, Code: "invalid_format", Message: "Некорректный формат параметра."})
	case errors.As(err, &tooMany):
		return problem.Validation(problem.FieldError{Field: tooMany.ParamName, Code: "too_many_values", Message: "Параметр указан несколько раз."})
	default:
		return problem.BadRequest("Некорректные параметры запроса.")
	}
}

// requestErrorHandler обрабатывает ошибки strict-сервера при разборе тела запроса.
// Валидатор контракта проверяет тело раньше, сюда доходят расхождения между
// схемой и Go-типом (например, число вне диапазона int32). Ошибку типа отдаём
// как ошибку поля; остальные тексты декодера клиенту не показываем — они
// описывают внутренние Go-типы, а не поля API.
func requestErrorHandler(w http.ResponseWriter, _ *http.Request, err error) {
	var typeErr *json.UnmarshalTypeError
	if errors.As(err, &typeErr) && typeErr.Field != "" {
		// Field — путь от корня по JSON-именам через точку, как и наш формат.
		problem.Write(w, problem.Validation(problem.FieldError{
			Field: typeErr.Field, Code: "invalid_type", Message: "Неверный тип значения.",
		}))
		return
	}
	problem.Write(w, problem.BadRequest("Не удалось разобрать тело запроса."))
}

// responseErrorHandler превращает ошибку, которую вернул обработчик, в ответ.
// *problem.Problem отдаётся как есть, всё остальное — 500 с общим текстом,
// а подробности пишутся в лог вместе с request id.
func responseErrorHandler(logger *slog.Logger) func(http.ResponseWriter, *http.Request, error) {
	return func(w http.ResponseWriter, r *http.Request, err error) {
		// Ответ-файл оборвался на середине (export.go): заголовки и часть тела
		// уже отправлены, дописывать Problem JSON некуда. Пишем в лог и рвём
		// соединение (http.ErrAbortHandler — штатный способ, net/http не
		// отправит завершающий chunk), чтобы клиент не принял обрезанный файл
		// за целый.
		var aborted *errStreamAborted
		if errors.As(err, &aborted) {
			level := slog.LevelError
			if errors.Is(err, context.Canceled) && r.Context().Err() != nil {
				level = slog.LevelInfo // клиент сам прервал загрузку
			}
			logger.LogAttrs(r.Context(), level, "stream aborted",
				slog.String("err", err.Error()),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.String("request_id", middleware.GetReqID(r.Context())),
			)
			panic(http.ErrAbortHandler)
		}
		var p *problem.Problem
		if errors.As(err, &p) && p.Status < http.StatusInternalServerError {
			problem.Write(w, p)
			return
		}
		attrs := []slog.Attr{
			slog.String("err", err.Error()),
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.String("request_id", middleware.GetReqID(r.Context())),
		}
		// Клиент закрыл соединение или отменил запрос — это не сбой сервера.
		if errors.Is(err, context.Canceled) && r.Context().Err() != nil {
			logger.LogAttrs(r.Context(), slog.LevelInfo, "request canceled by client", attrs...)
			w.WriteHeader(statusClientClosedRequest)
			return
		}
		logger.LogAttrs(r.Context(), slog.LevelError, "request failed", attrs...)
		problem.Write(w, problem.Internal())
	}
}
