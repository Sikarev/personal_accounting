package mail

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// Background отправляет письма в фоне: обработчик HTTP не ждёт SMTP-сервер.
// Это нужно не только ради скорости: время ответа на запрос сброса пароля
// не должно выдавать, есть ли аккаунт (письмо уходит только если он есть).
//
// Ограничение MVP: очереди нет. Письмо, отправка которого не закончилась
// до падения процесса, теряется (docs/api.md, «Письма»).
type Background struct {
	mailer  Mailer
	logger  *slog.Logger
	timeout time.Duration
	// wg считает письма в отправке: Wait ждёт, пока счётчик не станет нулём.
	wg sync.WaitGroup
}

// NewBackground создаёт фоновую отправку. timeout ограничивает отправку
// одного письма (соединение, TLS, передача).
func NewBackground(mailer Mailer, logger *slog.Logger, timeout time.Duration) *Background {
	return &Background{mailer: mailer, logger: logger, timeout: timeout}
}

// Send запускает отправку письма в отдельной горутине и сразу возвращается.
// Ошибка отправки пишется в лог вместе с attrs. В attrs и в лог не должны
// попадать токены и ссылки из письма: лог читают не только владельцы аккаунтов.
func (b *Background) Send(msg Message, attrs ...slog.Attr) {
	b.SendFunc(func(context.Context) (Message, error) { return msg, nil }, attrs...)
}

// SendFunc — как Send, но и письмо собирается в фоне: prepare может, например,
// создать токен в БД. Так обработчик запроса не тратит на это время, и время
// ответа не зависит от того, отправляется ли письмо. Ошибка prepare пишется
// в лог, письмо не отправляется. ctx у prepare — тот же, что у отправки
// (с таймаутом), а не контекст запроса.
func (b *Background) SendFunc(prepare func(ctx context.Context) (Message, error), attrs ...slog.Attr) {
	// wg.Go (Go 1.25) — то же, что wg.Add(1) + go func(){ defer wg.Done(); ... }().
	b.wg.Go(func() {
		// Свой контекст, а не контекст запроса: тот отменяется, как только
		// обработчик вернул ответ, и отправка оборвалась бы.
		ctx, cancel := context.WithTimeout(context.Background(), b.timeout)
		defer cancel()
		msg, err := prepare(ctx)
		if err != nil {
			b.logger.LogAttrs(ctx, slog.LevelError, "mail: prepare failed",
				append(attrs, slog.String("err", err.Error()))...)
			return
		}
		if err := b.mailer.Send(ctx, msg); err != nil {
			b.logger.LogAttrs(ctx, slog.LevelError, "mail: send failed",
				append(attrs, slog.String("err", err.Error()))...)
			return
		}
		b.logger.LogAttrs(ctx, slog.LevelInfo, "mail: sent", attrs...)
	})
}

// Wait ждёт окончания всех начатых отправок или отмены ctx (тогда возвращает
// ctx.Err()). Вызывается при остановке сервера — после того, как HTTP-сервер
// перестал принимать запросы, — и в тестах, чтобы дождаться писем без time.Sleep.
func (b *Background) Wait(ctx context.Context) error {
	done := make(chan struct{})
	go func() {
		b.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
