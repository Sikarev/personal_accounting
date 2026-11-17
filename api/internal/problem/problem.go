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
)

// ContentType — тип содержимого ответа с ошибкой.
const ContentType = "application/problem+json"

// Машиночитаемые коды ошибок. Клиент показывает текст по коду,
// поэтому коды — часть контракта: меняем только добавлением.
const (
	CodeBadRequest       = "bad_request"
	CodeValidationFailed = "validation_failed"
	CodeNotFound         = "not_found"
	CodeMethodNotAllowed = "method_not_allowed"
	CodeInternal         = "internal"
)

// Problem — тело ответа с ошибкой. Поля соответствуют схеме Problem в openapi.yaml.
type Problem struct {
	Type   string       `json:"type"`
	Title  string       `json:"title"`
	Status int          `json:"status"`
	Detail string       `json:"detail,omitempty"`
	Code   string       `json:"code"`
	Errors []FieldError `json:"errors,omitempty"`
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
	w.WriteHeader(p.Status)
	// Ошибку записи игнорируем: клиент уже мог отключиться, сообщить ему нечего.
	_ = json.NewEncoder(w).Encode(p)
}
