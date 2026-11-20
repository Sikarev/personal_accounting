package mail

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"net"
	"net/mail"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"
)

var testFrom = mail.Address{Name: "Домашняя бухгалтерия", Address: "no-reply@example.com"}

func TestBuildMultipartAndCyrillic(t *testing.T) {
	msg, err := VerifyEmail(Letter{Name: "Иван <b>", Email: "ivan@example.com", Link: "http://localhost:5173/verify-email?token=abc_-1"})
	if err != nil {
		t.Fatal(err)
	}
	raw, rcpt, err := build(testFrom, msg, time.Date(2026, 11, 21, 10, 0, 0, 0, time.UTC))
	if err != nil || rcpt != "ivan@example.com" {
		t.Fatal(rcpt, err)
	}

	// Разбираем письмо так же, как почтовый клиент.
	m, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	dec := new(mime.WordDecoder)
	subject, err := dec.DecodeHeader(m.Header.Get("Subject"))
	if err != nil || subject != "Подтвердите e-mail в Домашней бухгалтерии" {
		t.Fatalf("тема: %q, %v; сырая: %q", subject, err, m.Header.Get("Subject"))
	}
	from, err := m.Header.AddressList("From")
	if err != nil || from[0].Name != testFrom.Name || from[0].Address != testFrom.Address {
		t.Fatalf("From: %v %v", from, err)
	}
	if to := m.Header.Get("To"); to != "<ivan@example.com>" {
		t.Fatalf("To: %q", to)
	}
	for _, h := range []string{"Date", "Message-Id", "Mime-Version"} {
		if m.Header.Get(h) == "" {
			t.Errorf("нет заголовка %s", h)
		}
	}
	// В сыром письме только ASCII: кириллица закодирована.
	for _, b := range raw {
		if b > 127 {
			t.Fatal("в письме есть не-ASCII байты")
		}
	}

	mediaType, params, err := mime.ParseMediaType(m.Header.Get("Content-Type"))
	if err != nil || mediaType != "multipart/alternative" {
		t.Fatalf("Content-Type: %q %v", mediaType, err)
	}
	mr := multipart.NewReader(m.Body, params["boundary"])
	var parts []string
	var bodies []string
	for {
		p, err := mr.NextPart() // сам декодирует quoted-printable
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(p)
		parts = append(parts, p.Header.Get("Content-Type"))
		bodies = append(bodies, string(b))
	}
	if len(parts) != 2 || parts[0] != "text/plain; charset=utf-8" || parts[1] != "text/html; charset=utf-8" {
		t.Fatalf("части: %v", parts)
	}
	if !strings.Contains(bodies[0], "Здравствуйте, Иван <b>!") || !strings.Contains(bodies[0], "http://localhost:5173/verify-email?token=abc_-1") {
		t.Fatalf("текст: %s", bodies[0])
	}
	// html/template экранирует имя.
	if !strings.Contains(bodies[1], "Иван &lt;b&gt;") || strings.Contains(bodies[1], "<b>") {
		t.Fatalf("HTML: %s", bodies[1])
	}
	if !strings.Contains(bodies[1], `href="http://localhost:5173/verify-email?token=abc_-1"`) {
		t.Fatalf("ссылка в HTML: %s", bodies[1])
	}
}

func TestBuildRejectsHeaderInjection(t *testing.T) {
	for _, msg := range []Message{
		{To: "a@example.com\r\nBcc: b@example.com", Subject: "x"},
		{To: "a@example.com", Subject: "x\nBcc: b@example.com"},
		{To: "not an address", Subject: "x"},
	} {
		if _, _, err := build(testFrom, msg, time.Now()); err == nil {
			t.Errorf("принято: %+v", msg)
		}
	}
}

func TestResetPasswordTemplate(t *testing.T) {
	msg, err := ResetPassword(Letter{Name: "Анна", Email: "anna@example.com", Link: "https://app.example/reset-password?token=t"})
	if err != nil {
		t.Fatal(err)
	}
	if msg.To != "anna@example.com" || msg.Subject != "Восстановление пароля в Домашней бухгалтерии" ||
		!strings.Contains(msg.Text, "https://app.example/reset-password?token=t") ||
		!strings.Contains(msg.HTML, `href="https://app.example/reset-password?token=t"`) {
		t.Fatalf("%+v", msg)
	}
}

// blockingMailer ждёт сигнала, прежде чем «отправить» письмо.
type blockingMailer struct {
	release chan struct{}
	mu      sync.Mutex
	sent    int
}

func (m *blockingMailer) Send(ctx context.Context, _ Message) error {
	select {
	case <-m.release:
	case <-ctx.Done():
		return ctx.Err()
	}
	m.mu.Lock()
	m.sent++
	m.mu.Unlock()
	return nil
}

func TestBackgroundWait(t *testing.T) {
	m := &blockingMailer{release: make(chan struct{})}
	b := NewBackground(m, slog.New(slog.DiscardHandler), time.Minute)
	b.Send(Message{To: "a@example.com"})
	b.Send(Message{To: "b@example.com"})

	// Пока письма «в отправке», Wait с коротким сроком возвращает ошибку контекста.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if err := b.Wait(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Wait: %v", err)
	}

	close(m.release)
	if err := b.Wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if m.sent != 2 {
		t.Fatalf("отправлено %d", m.sent)
	}
}

// После Close новые письма не запускаются (и не нарушают контракт
// WaitGroup, даже если Send идёт одновременно с Wait), уже начатые — дожидаются.
func TestBackgroundClose(t *testing.T) {
	var buf bytes.Buffer
	var logMu sync.Mutex
	logger := slog.New(slog.NewTextHandler(&lockedWriter{w: &buf, mu: &logMu}, nil))
	m := &blockingMailer{release: make(chan struct{})}
	b := NewBackground(m, logger, time.Minute)
	b.Send(Message{To: "a@example.com"})
	b.Close()
	b.Close() // повторный вызов безопасен

	// Отправки после Close — одновременно с Wait (сценарий Shutdown по таймауту).
	var wg sync.WaitGroup
	for range 10 {
		wg.Go(func() {
			b.Send(Message{To: "late@example.com", Text: "secret-token"}, slog.String("kind", "reset_password"))
		})
	}
	waitErr := make(chan error, 1)
	go func() { waitErr <- b.Wait(context.Background()) }()
	wg.Wait()
	close(m.release)
	if err := <-waitErr; err != nil {
		t.Fatal(err)
	}
	if m.sent != 1 {
		t.Fatalf("отправлено %d, ожидалось 1 (до Close)", m.sent)
	}
	logMu.Lock()
	out := buf.String()
	logMu.Unlock()
	if strings.Count(out, "mail: dropped, sender closed") != 10 || !strings.Contains(out, "kind=reset_password") ||
		strings.Contains(out, "secret-token") || strings.Contains(out, "late@example.com") {
		t.Fatalf("лог: %s", out)
	}
}

type lockedWriter struct {
	w  io.Writer
	mu *sync.Mutex
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}

func TestBackgroundLogsErrorWithoutBody(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buf, nil))
	b := NewBackground(failingMailer{}, logger, time.Second)
	b.Send(Message{To: "a@example.com", Text: "secret-token"}, slog.String("kind", "verify_email"))
	_ = b.Wait(context.Background())
	out := buf.String()
	if !strings.Contains(out, "mail: send failed") || !strings.Contains(out, "kind=verify_email") || strings.Contains(out, "secret-token") {
		t.Fatalf("лог: %s", out)
	}
}

type failingMailer struct{}

func (failingMailer) Send(context.Context, Message) error { return errors.New("connection refused") }

// fakeSMTP — минимальный SMTP-сервер: принимает одно письмо и отдаёт его в канал.
// Проверяет, что SMTP.Send говорит по протоколу и передаёт письмо целиком.
func fakeSMTP(t *testing.T) (addr string, got <-chan string) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	ch := make(chan string, 1)
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		tp := textproto.NewConn(conn)
		_ = tp.PrintfLine("220 fake ESMTP")
		var data strings.Builder
		for {
			line, err := tp.ReadLine()
			if err != nil {
				return
			}
			cmd := strings.ToUpper(strings.SplitN(line, " ", 2)[0])
			switch cmd {
			case "EHLO":
				_ = tp.PrintfLine("250-fake")
				_ = tp.PrintfLine("250 8BITMIME")
			case "MAIL", "RCPT":
				data.WriteString(line + "\n")
				_ = tp.PrintfLine("250 ok")
			case "DATA":
				_ = tp.PrintfLine("354 go ahead")
				b, err := tp.ReadDotBytes()
				if err != nil {
					return
				}
				data.Write(b)
				_ = tp.PrintfLine("250 queued")
			case "QUIT":
				_ = tp.PrintfLine("221 bye")
				ch <- data.String()
				return
			default:
				_ = tp.PrintfLine("502 unknown")
			}
		}
	}()
	return ln.Addr().String(), ch
}

func TestSMTPSend(t *testing.T) {
	addr, got := fakeSMTP(t)
	host, port, _ := net.SplitHostPort(addr)
	s := SMTP{Host: host, Port: port, From: testFrom}
	msg, _ := VerifyEmail(Letter{Name: "Иван", Email: "ivan@example.com", Link: "http://x/verify-email?token=t"})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.Send(ctx, msg); err != nil {
		t.Fatal(err)
	}
	data := <-got
	if !strings.Contains(data, "MAIL FROM:<no-reply@example.com>") || !strings.Contains(data, "RCPT TO:<ivan@example.com>") {
		t.Fatalf("конверт: %s", data)
	}
	m, err := mail.ReadMessage(bufio.NewReader(strings.NewReader(data[strings.Index(data, "From:"):])))
	if err != nil {
		t.Fatal(err)
	}
	if m.Header.Get("To") != "<ivan@example.com>" {
		t.Fatalf("письмо: %v", m.Header)
	}
}

// Адрес в угловых скобках или с именем: в конверт и в To уходит только адрес.
func TestSMTPSendUsesParsedRecipient(t *testing.T) {
	for _, to := range []string{"<ivan@example.com>", "Иван <ivan@example.com>"} {
		addr, got := fakeSMTP(t)
		host, port, _ := net.SplitHostPort(addr)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := SMTP{Host: host, Port: port, From: testFrom}.Send(ctx, Message{To: to, Subject: "x", Text: "x", HTML: "x"})
		cancel()
		if err != nil {
			t.Fatal(err)
		}
		data := <-got
		if !strings.Contains(data, "RCPT TO:<ivan@example.com>\n") || !strings.Contains(data, "\nTo: <ivan@example.com>\n") {
			t.Fatalf("%s: %q", to, data)
		}
	}
}

func TestSMTPSendRespectsContext(t *testing.T) {
	// Сервер принимает соединение и молчит: без учёта ctx Send висел бы вечно.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err == nil {
			defer conn.Close()
			time.Sleep(5 * time.Second)
		}
	}()
	host, port, _ := net.SplitHostPort(ln.Addr().String())
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	start := time.Now()
	err = SMTP{Host: host, Port: port, From: testFrom}.Send(ctx, Message{To: "a@example.com", Subject: "x"})
	if err == nil || time.Since(start) > 3*time.Second {
		t.Fatalf("Send: %v за %v", err, time.Since(start))
	}
}
