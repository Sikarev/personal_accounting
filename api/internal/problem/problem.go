// Package problem — ошибки API в формате RFC 9457 (Problem Details,
// Content-Type: application/problem+json) с машиночитаемым полем code.
//
// Обработчик возвращает *Problem как обычную ошибку (тип реализует интерфейс error),
// а общий обработчик ошибок HTTP-слоя превращает её в ответ. Любая другая ошибка
// считается непредвиденной: клиент получает 500 с общим текстом, подробности — в лог.
package problem

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"
)

// ContentType — тип содержимого ответа с ошибкой.
const ContentType = "application/problem+json"

// Машиночитаемые коды ошибок. Клиент показывает текст по коду,
// поэтому коды — часть контракта: меняем только добавлением.
const (
	CodeBadRequest         = "bad_request"
	CodeValidationFailed   = "validation_failed"
	CodeUnauthorized       = "unauthorized"
	CodeInvalidCredentials = "invalid_credentials"
	CodeForbiddenOrigin    = "forbidden_origin"
	CodeNotFound           = "not_found"
	CodeMethodNotAllowed   = "method_not_allowed"
	CodeTooManyRequests    = "too_many_requests"
	CodeInternal           = "internal"
)

// Problem — тело ответа с ошибкой. Поля соответствуют схеме Problem в openapi.yaml.
type Problem struct {
	Type   string       `json:"type"`
	Title  string       `json:"title"`
	Status int          `json:"status"`
	Detail string       `json:"detail,omitempty"`
	Code   string       `json:"code"`
	Errors []FieldError `json:"errors,omitempty"`

	// RetryAfter — не поле тела, а заголовок Retry-After (для 429).
	// Тег json:"-" исключает поле из JSON.
	RetryAfter time.Duration `json:"-"`
}

// FieldError — ошибка конкретного поля при code = validation_failed.
type FieldError struct {
	Field   string `json:"field"`   // путь в camelCase через точку: "amount", "splits.0.amount"
	Code    string `json:"code"`    // "required", "invalid_format", ...
	Message string `json:"message"` // пояснение на русском
}

// Error делает *Problem обычной ошибкой Go, чтобы её можно было вернуть из обработчика.
func (p *Problem) Error() string {
	if p.Detail != "" {
		return p.Code + ": " + p.Detail
	}
	return p.Code
}

// New создаёт ошибку с заданным статусом. Title берётся из стандартной фразы
// HTTP-статуса — так RFC 9457 рекомендует для type = about:blank.
func New(status int, code, detail string) *Problem {
	return &Problem{
		Type:   "about:blank",
		Title:  http.StatusText(status),
		Status: status,
		Detail: detail,
		Code:   code,
	}
}

func BadRequest(detail string) *Problem {
	return New(http.StatusBadRequest, CodeBadRequest, detail)
}

// Validation — ошибка валидации с перечнем полей. Статус 422, а не 400:
// запрос разобран, но данные не прошли проверку — клиент исправляет поля
// из errors. 400 (bad_request) остаётся для запросов, которые не разобрать вовсе.
func Validation(errs ...FieldError) *Problem {
	p := New(http.StatusUnprocessableEntity, CodeValidationFailed, "Некорректные данные запроса.")
	p.Errors = errs
	return p
}

// Unauthorized — нет действующей сессии: cookie нет, сессия истекла или удалена.
func Unauthorized() *Problem {
	return New(http.StatusUnauthorized, CodeUnauthorized, "Требуется вход.")
}

// InvalidCredentials — неверный e-mail или пароль. Текст один на оба случая,
// чтобы ответ не выдавал, зарегистрирован ли e-mail.
func InvalidCredentials() *Problem {
	return New(http.StatusUnauthorized, CodeInvalidCredentials, "Неверный e-mail или пароль.")
}

// ForbiddenOrigin — запрос, меняющий данные, пришёл со страницы другого сайта (CSRF).
func ForbiddenOrigin() *Problem {
	return New(http.StatusForbidden, CodeForbiddenOrigin, "Запрос с другого сайта отклонён.")
}

// TooManyRequests — превышен лимит частоты; retryAfter уходит в заголовок Retry-After.
func TooManyRequests(retryAfter time.Duration) *Problem {
	p := New(http.StatusTooManyRequests, CodeTooManyRequests, "Слишком много попыток. Попробуйте позже.")
	p.RetryAfter = retryAfter
	return p
}

func NotFound(detail string) *Problem {
	return New(http.StatusNotFound, CodeNotFound, detail)
}

func MethodNotAllowed() *Problem {
	return New(http.StatusMethodNotAllowed, CodeMethodNotAllowed, "Метод не поддерживается для этого адреса.")
}

// Internal — ответ на непредвиденную ошибку. Текст намеренно общий:
// подробности (SQL, пути, стек) не должны утекать клиенту.
func Internal() *Problem {
	return New(http.StatusInternalServerError, CodeInternal, "Внутренняя ошибка сервера. Попробуйте позже.")
}

// Write отправляет ошибку клиенту.
func Write(w http.ResponseWriter, p *Problem) {
	w.Header().Set("Content-Type", ContentType)
	if p.RetryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(retryAfterSeconds(p.RetryAfter)))
	}
	w.WriteHeader(p.Status)
	// Ошибку записи игнорируем: клиент уже мог отключиться, сообщить ему нечего.
	_ = json.NewEncoder(w).Encode(p)
}

// retryAfterSeconds округляет вверх до целых секунд (формат заголовка —
// целое число секунд), но не меньше 1: «0» клиент понял бы как «повторяй сразу».
func retryAfterSeconds(d time.Duration) int {
	sec := int((d + time.Second - 1) / time.Second)
	return max(sec, 1)
}
