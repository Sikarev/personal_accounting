package mail

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strings"
	"time"
)

// SMTP отправляет письма через SMTP-сервер (в разработке — Mailpit).
//
// Поведение как у smtp.SendMail: STARTTLS, если сервер его предлагает;
// вход (PLAIN), если задан Username. smtp.PlainAuth откажется передавать
// пароль по соединению без TLS (кроме localhost) — это защита стандартной
// библиотеки, а не ошибка настройки. Mailpit логина не требует.
//
// В отличие от smtp.SendMail, учитывает ctx: соединение закрывается
// по таймауту или отмене, и горутина отправки не висит вечно.
type SMTP struct {
	Host     string
	Port     string
	Username string
	Password string
	From     mail.Address
}

func (s SMTP) Send(ctx context.Context, msg Message) error {
	raw, to, err := build(s.From, msg, time.Now())
	if err != nil {
		return err
	}

	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(s.Host, s.Port))
	if err != nil {
		return fmt.Errorf("smtp dial: %w", err)
	}
	// net/smtp не принимает context. Поэтому: срок контекста — дедлайн
	// соединения, а отмена контекста закрывает соединение, и любая
	// операция smtp.Client сразу вернёт ошибку.
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()

	c, err := smtp.NewClient(conn, s.Host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("smtp handshake: %w", err)
	}
	defer c.Close()

	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(&tls.Config{ServerName: s.Host}); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	}
	if s.Username != "" {
		if ok, _ := c.Extension("AUTH"); !ok {
			return errors.New("smtp: сервер не поддерживает AUTH, а SMTP_USERNAME задан")
		}
		if err := c.Auth(smtp.PlainAuth("", s.Username, s.Password, s.Host)); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := c.Mail(s.From.Address); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	// Разобранный адрес, а не msg.To как есть: «<a@x.com>» иначе ушёл бы
	// как RCPT TO:<<a@x.com>>, а адрес с именем — вовсе не тем получателем.
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("smtp RCPT TO: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp end of data: %w", err)
	}
	return c.Quit()
}

// build собирает письмо в формате RFC 5322: multipart/alternative
// с text/plain и text/html в UTF-8. Тело — в quoted-printable: строки
// не длиннее 76 символов, кириллица передаётся без потерь через любые
// SMTP-серверы. Заголовки с кириллицей кодируются encoded-word (RFC 2047).
// Возвращает и адрес получателя для конверта (RCPT TO) — тот же, что в To.
func build(from mail.Address, msg Message, now time.Time) (raw []byte, rcpt string, err error) {
	// Перевод строки в заголовке позволил бы дописать свои заголовки
	// (header injection). Адрес проверяет контракт, но держим защиту здесь.
	if strings.ContainsAny(msg.To, "\r\n") || strings.ContainsAny(msg.Subject, "\r\n") {
		return nil, "", errors.New("mail: перевод строки в заголовке письма")
	}
	to, err := mail.ParseAddress(msg.To)
	if err != nil {
		return nil, "", fmt.Errorf("mail: адрес получателя: %w", err)
	}

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for _, part := range []struct{ contentType, content string }{
		// Порядок важен: почтовый клиент показывает последнюю часть, которую умеет.
		{"text/plain; charset=utf-8", msg.Text},
		{"text/html; charset=utf-8", msg.HTML},
	} {
		pw, err := mw.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {part.contentType},
			"Content-Transfer-Encoding": {"quoted-printable"},
		})
		if err != nil {
			return nil, "", err
		}
		qp := quotedprintable.NewWriter(pw)
		if _, err := qp.Write([]byte(part.content)); err != nil {
			return nil, "", err
		}
		if err := qp.Close(); err != nil {
			return nil, "", err
		}
	}
	if err := mw.Close(); err != nil {
		return nil, "", err
	}

	var b bytes.Buffer
	header := func(k, v string) { b.WriteString(k + ": " + v + "\r\n") }
	header("From", from.String()) // mail.Address.String кодирует имя по RFC 2047
	header("To", (&mail.Address{Address: to.Address}).String())
	header("Subject", mime.QEncoding.Encode("utf-8", msg.Subject))
	header("Date", now.Format(time.RFC1123Z))
	header("Message-ID", messageID(from.Address))
	header("MIME-Version", "1.0")
	header("Content-Type", "multipart/alternative; boundary="+mw.Boundary())
	b.WriteString("\r\n")
	b.Write(body.Bytes())
	return b.Bytes(), to.Address, nil
}

// messageID — уникальный идентификатор письма вида <случайное@домен-отправителя>.
// Без него часть спам-фильтров снижает доверие к письму.
func messageID(from string) string {
	domain := "localhost"
	if i := strings.LastIndexByte(from, '@'); i >= 0 {
		domain = from[i+1:]
	}
	r := make([]byte, 16)
	_, _ = rand.Read(r)
	return "<" + hex.EncodeToString(r) + "@" + domain + ">"
}
