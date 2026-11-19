package httpapi

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/go-chi/chi/v5"

	"personal-accounting/api/internal/problem"
)

// Формат uuid kin-openapi по умолчанию не проверяет, а его встроенный шаблон
// RFC 4122 допускает только версии 1–5 — наши id это uuidv7. Регистрация
// глобальная (реестр форматов kin-openapi): опция Options.SchemaValidationOptions
// в v0.142.0 не применяется к параметрам. init выполняется один раз до main,
// поэтому гонок нет, а значение не меняется — это настройка библиотеки, не состояние.
func init() {
	openapi3.DefineStringFormatValidator("uuid", openapi3.NewRegexpFormatValidator(
		`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`))
	// format: email kin-openapi по умолчанию не проверяет. Пробелы по краям
	// допускаем: сервер их обрезает (normalizeEmail), ошибкой они не считаются.
	openapi3.DefineStringFormatCallback("email", func(s string) error {
		if !validEmail.MatchString(strings.TrimSpace(s)) {
			return errors.New("invalid email")
		}
		return nil
	})
}

// validEmail — грубая проверка «что-то@домен.зона» без пробелов. Строже
// проверять незачем: существование адреса подтвердит письмо.
var validEmail = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

// specRoutes — операции контракта по ключу «МЕТОД /api/v1/шаблон/{пути}».
//
// Middleware ставятся на маршруты, уже найденные chi, поэтому операцию из
// спецификации ищем по шаблону маршрута chi (у chi и OpenAPI одинаковый синтаксис
// параметров: /accounts/{accountId}), а не роутером kin-openapi.
type specRoutes map[string]*routers.Route

// newSpecRoutes строит таблицу операций. prefix — префикс, под которым
// смонтированы пути спецификации ("/api/v1").
func newSpecRoutes(doc *openapi3.T, prefix string) specRoutes {
	routes := specRoutes{}
	for path, item := range doc.Paths.Map() {
		for method, op := range item.Operations() {
			routes[method+" "+prefix+path] = &routers.Route{
				Spec: doc, Path: path, PathItem: item, Method: method, Operation: op,
			}
		}
	}
	return routes
}

// find возвращает операцию контракта для запроса, уже сопоставленного chi.
func (rs specRoutes) find(r *http.Request) (*routers.Route, bool) {
	rctx := chi.RouteContext(r.Context())
	if rctx == nil {
		return nil, false
	}
	// Для HEAD middleware.GetHead маршрутизирует запрос как GET.
	method := rctx.RouteMethod
	if method == "" {
		method = r.Method
	}
	route, ok := rs[method+" "+rctx.RoutePattern()]
	return route, ok
}

// requestValidator возвращает middleware, которое проверяет запрос по контракту
// (kin-openapi): параметры пути и query, обязательные поля тела, типы, enum,
// длины, лишние поля (при additionalProperties: false). Ответы не проверяются.
// prefix — префикс, под которым смонтированы пути спецификации ("/api/v1").
func requestValidator(logger *slog.Logger, doc *openapi3.T, prefix string) func(http.Handler) http.Handler {
	routes := newSpecRoutes(doc, prefix)
	opts := &openapi3filter.Options{
		MultiError: true, // собрать ошибки по всем полям сразу, а не только первую
		// RejectWhenRequestBodyNotSpecified не используем: в kin-openapi v0.142.0
		// он срабатывает на любое тело, даже описанное в контракте. Проверяем сами ниже.
		// Сессию проверяет свой middleware (authenticate) до валидатора,
		// поэтому здесь проверка схем безопасности — пустая.
		AuthenticationFunc: openapi3filter.NoopAuthenticationFunc,
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			route, ok := routes.find(r)
			if !ok {
				// Маршрут есть в chi, но не в спецификации — ошибка сборки роутера,
				// а не клиента: молча пропустить её нельзя.
				responseErrorHandler(logger)(w, r, fmt.Errorf("операция %s %s не найдена в спецификации", r.Method, r.URL.Path))
				return
			}
			rctx := chi.RouteContext(r.Context())

			// Тело у операции без requestBody в контракте — ошибка клиента.
			if route.Operation.RequestBody == nil && r.ContentLength > 0 {
				problem.Write(w, problem.BadRequest("У этого запроса не должно быть тела."))
				return
			}

			params := make(map[string]string, len(rctx.URLParams.Keys))
			for i, k := range rctx.URLParams.Keys {
				params[k] = rctx.URLParams.Values[i]
			}
			err := openapi3filter.ValidateRequest(r.Context(), &openapi3filter.RequestValidationInput{
				Request: r, PathParams: params, Route: route, Options: opts,
			})
			if err != nil {
				problem.Write(w, validationProblem(err))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// validationProblem превращает ошибки kin-openapi в problem+json:
// ошибки схемы — в validation_failed с errors[] по полям, а тело,
// которое не удалось разобрать как JSON, — в bad_request.
func validationProblem(err error) *problem.Problem {
	var fields []problem.FieldError
	if malformed := collectFieldErrors(err, "", &fields); malformed || len(fields) == 0 {
		return problem.BadRequest("Не удалось разобрать запрос.")
	}
	return problem.Validation(fields...)
}

// collectFieldErrors обходит дерево ошибок (MultiError вложены друг в друга)
// и собирает ошибки полей. param — имя параметра, если обходим его ошибки.
// Возвращает true, если запрос не разобран вовсе (невалидный JSON и т. п.).
func collectFieldErrors(err error, param string, out *[]problem.FieldError) (malformed bool) {
	// Смотрим на конкретный тип текущего узла, а не errors.As: errors.As
	// «проваливается» внутрь RequestError и теряет, к какому параметру относится ошибка.
	switch e := err.(type) {
	case openapi3.MultiError:
		for _, inner := range e {
			if collectFieldErrors(inner, param, out) {
				malformed = true
			}
		}
		return malformed

	case *openapi3filter.RequestError:
		if e.Parameter != nil {
			before := len(*out)
			collectFieldErrors(e.Err, e.Parameter.Name, out)
			if len(*out) == before { // не ошибка схемы: параметр отсутствует или не разобран
				code, msg := "invalid_format", "Некорректный формат параметра."
				if errors.Is(e.Err, openapi3filter.ErrInvalidRequired) {
					code, msg = "required", "Обязательный параметр."
				}
				*out = append(*out, problem.FieldError{Field: e.Parameter.Name, Code: code, Message: msg})
			}
			return false
		}
		if e.Err == nil {
			return true
		}
		return collectFieldErrors(e.Err, param, out)

	case *openapi3.SchemaError:
		*out = append(*out, schemaFieldError(e, param))
		return false
	}

	var schemaErr *openapi3.SchemaError
	if errors.As(err, &schemaErr) {
		*out = append(*out, schemaFieldError(schemaErr, param))
		return false
	}

	// Остальное — ошибки разбора: невалидный JSON, неподдерживаемый Content-Type,
	// отсутствующее обязательное тело.
	return true
}

// kin-openapi сообщает о лишнем поле только текстом причины, имя поля — в кавычках.
var unsupportedProperty = regexp.MustCompile(`^property (".*") is unsupported$`)

func schemaFieldError(e *openapi3.SchemaError, param string) problem.FieldError {
	path := e.JSONPointer()
	code, msg := "invalid", "Недопустимое значение."
	switch e.SchemaField {
	case "required":
		code, msg = "required", "Обязательное поле."
	case "type", "nullable":
		code, msg = "invalid_type", "Неверный тип значения."
	case "enum":
		code, msg = "invalid_value", "Значение не из списка допустимых."
	case "maxLength":
		code, msg = "too_long", fmt.Sprintf("Не длиннее %d символов.", derefUint(e.Schema.MaxLength))
	case "minLength":
		code, msg = "too_short", fmt.Sprintf("Не короче %d символов.", e.Schema.MinLength)
	case "maximum", "exclusiveMaximum":
		code, msg = "too_large", "Слишком большое значение."
	case "minimum", "exclusiveMinimum":
		code, msg = "too_small", "Слишком маленькое значение."
	case "maxItems":
		code, msg = "too_many_items", "Слишком много элементов."
	case "minItems":
		code, msg = "too_few_items", "Слишком мало элементов."
	case "pattern", "format":
		code, msg = "invalid_format", "Неверный формат."
	case "properties":
		if m := unsupportedProperty.FindStringSubmatch(e.Reason); m != nil {
			if name, err := strconv.Unquote(m[1]); err == nil {
				path = append(path, name)
			}
			code, msg = "unknown_field", "Неизвестное поле."
		}
	}

	field := strings.Join(path, ".")
	if param != "" {
		field = strings.Join(append([]string{param}, path...), ".")
	}
	return problem.FieldError{Field: field, Code: code, Message: msg}
}

func derefUint(p *uint64) uint64 {
	if p == nil {
		return 0
	}
	return *p
}
