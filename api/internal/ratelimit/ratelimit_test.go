package ratelimit

import (
	"testing"
	"time"
)

// clock — подменяемые часы: тест сам двигает время.
type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func TestAllowSlidingWindow(t *testing.T) {
	c := &clock{t: time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC)}
	l := New(Rule{Limit: 3, Window: time.Minute}, c.now)

	for i := range 3 {
		if _, ok := l.Allow("a"); !ok {
			t.Fatalf("событие %d отклонено", i+1)
		}
		c.t = c.t.Add(10 * time.Second)
	}
	// Сейчас 12:00:30, события в 00, 10, 20 — лимит исчерпан.
	retry, ok := l.Allow("a")
	if ok {
		t.Fatal("4-е событие в окне разрешено")
	}
	if retry != 30*time.Second {
		t.Fatalf("retryAfter = %v, ожидалось 30s (выйдет событие 12:00:00)", retry)
	}
	// Другой ключ считается отдельно.
	if _, ok := l.Allow("b"); !ok {
		t.Fatal("ключ b заблокирован из-за ключа a")
	}

	c.t = c.t.Add(30 * time.Second) // 12:01:00 — событие 12:00:00 вышло из окна
	if _, ok := l.Allow("a"); !ok {
		t.Fatal("событие после освобождения окна отклонено")
	}
	if _, ok := l.Allow("a"); ok {
		t.Fatal("окно снова полно, но событие разрешено")
	}

	l.Reset("a")
	if _, ok := l.Allow("a"); !ok {
		t.Fatal("после Reset событие отклонено")
	}
}

func TestOldKeysAreSwept(t *testing.T) {
	c := &clock{t: time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC)}
	l := New(Rule{Limit: 5, Window: time.Minute}, c.now)
	for _, k := range []string{"1", "2", "3"} {
		l.Allow(k)
	}
	if l.Len() != 3 {
		t.Fatalf("Len = %d", l.Len())
	}
	c.t = c.t.Add(2 * time.Minute)
	l.Allow("4") // любое обращение после окна запускает уборку
	if l.Len() != 1 {
		t.Fatalf("после уборки ключей %d, ожидался 1", l.Len())
	}
}
