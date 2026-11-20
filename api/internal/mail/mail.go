// Package mail — отправка писем: интерфейс Mailer, его реализации (SMTP
// и in-memory для тестов), фоновая отправка и шаблоны писем.
package mail

import (
	"context"
	"slices"
	"sync"
)

// Message — письмо: один получатель, текстовая и HTML-версии.
type Message struct {
	To      string // адрес получателя, без имени
	Subject string
	Text    string // text/plain
	HTML    string // text/html; уже экранированный (html/template)
}

// Mailer отправляет письмо. Реализация должна уважать ctx (таймаут, отмену).
type Mailer interface {
	Send(ctx context.Context, msg Message) error
}

// Memory — Mailer для тестов: письма не отправляются, а запоминаются.
// Безопасен для использования из нескольких горутин.
type Memory struct {
	mu   sync.Mutex
	msgs []Message
}

func (m *Memory) Send(_ context.Context, msg Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.msgs = append(m.msgs, msg)
	return nil
}

// Messages возвращает копию отправленных писем, от старых к новым.
func (m *Memory) Messages() []Message {
	m.mu.Lock()
	defer m.mu.Unlock()
	return slices.Clone(m.msgs)
}

// Discard — Mailer, который молча выбрасывает письма. Нужен только как
// значение по умолчанию в тестах, которым письма не интересны.
type Discard struct{}

func (Discard) Send(context.Context, Message) error { return nil }
