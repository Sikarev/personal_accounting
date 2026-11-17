package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"

	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/problem"
)

// Все ответы с ошибками под /api проходят через функции этого файла,
// поэтому формат ошибок везде одинаковый — problem+json.

func notFound(w http.ResponseWriter, _ *http.Request) {
	problem.Write(w, problem.NotFound("Адрес не найден."))
}

func methodNotAllowed(w http.ResponseWriter, _ *http.Request) {
	problem.Write(w, problem.MethodNotAllowed())
}

// paramErrorHandler обрабатывает ошибки разбора параметров пути, query
// и заголовков (их возвращает сгенерированная обёртка oapi-codegen).
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

// requestErrorHandler обрабатывает ошибки strict-сервера при разборе тела запроса
// (например, невалидный JSON). Текст ошибки декодера клиенту не отдаём:
// он описывает внутренние Go-типы, а не поля API.
func requestErrorHandler(w http.ResponseWriter, _ *http.Request, _ error) {
	problem.Write(w, problem.BadRequest("Не удалось разобрать тело запроса."))
}

// responseErrorHandler превращает ошибку, которую вернул обработчик, в ответ.
// *problem.Problem отдаётся как есть, всё остальное — 500 с общим текстом,
// а подробности пишутся в лог вместе с request id.
func responseErrorHandler(logger *slog.Logger) func(http.ResponseWriter, *http.Request, error) {
	return func(w http.ResponseWriter, r *http.Request, err error) {
		var p *problem.Problem
		if errors.As(err, &p) && p.Status < http.StatusInternalServerError {
			problem.Write(w, p)
			return
		}
		logger.LogAttrs(r.Context(), slog.LevelError, "request failed",
			slog.String("err", err.Error()),
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.String("request_id", middleware.GetReqID(r.Context())),
		)
		problem.Write(w, problem.Internal())
	}
}
