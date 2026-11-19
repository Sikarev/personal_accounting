// Package ratelimit — ограничение частоты событий в памяти процесса.
//
// Скользящее окно: для каждого ключа (IP, e-mail) хранятся моменты событий
// за последние Window, событие разрешено, пока их меньше Limit. Состояние
// живёт в одном процессе: при нескольких экземплярах API у каждого свой счёт
// (ограничение MVP, описано в docs/api.md).
package ratelimit

import (
	"sync"
	"time"
)

// Rule — не больше Limit событий за Window.
type Rule struct {
	Limit  int
	Window time.Duration
}

// Limiter безопасен для одновременного использования из нескольких горутин.
type Limiter struct {
	rule Rule
	now  func() time.Time

	// mu защищает поля ниже: обработчики HTTP работают параллельно.
	mu        sync.Mutex
	events    map[string][]time.Time // по ключу — моменты событий в окне, от старых к новым
	nextSweep time.Time
}

// New создаёт ограничитель. now — источник времени (в тестах подменяется).
func New(rule Rule, now func() time.Time) *Limiter {
	return &Limiter{rule: rule, now: now, events: map[string][]time.Time{}}
}

// Allow учитывает событие, если лимит не исчерпан, и возвращает ok = true.
// Иначе событие не учитывается, а retryAfter — через сколько освободится место.
func (l *Limiter) Allow(key string) (retryAfter time.Duration, ok bool) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	l.sweep(now)
	events := l.prune(key, now)
	if len(events) >= l.rule.Limit {
		// Место освободится, когда из окна выйдет самое старое событие.
		return events[0].Add(l.rule.Window).Sub(now), false
	}
	l.events[key] = append(events, now)
	return 0, true
}

// Reset забывает события ключа (например, после успешного входа).
func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.events, key)
}

// Len — число ключей в памяти. Нужен тестам очистки.
func (l *Limiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.events)
}

// prune убирает события ключа старше окна и возвращает оставшиеся.
// Вызывается под l.mu.
func (l *Limiter) prune(key string, now time.Time) []time.Time {
	events := l.events[key]
	cutoff := now.Add(-l.rule.Window)
	i := 0
	for i < len(events) && !events[i].After(cutoff) {
		i++
	}
	events = events[i:]
	if len(events) == 0 {
		delete(l.events, key)
		return nil
	}
	l.events[key] = events
	return events
}

// sweep раз в окно проходит по всем ключам и удаляет устаревшие, иначе ключи,
// которые больше не встречаются (разовые IP), копились бы бесконечно.
// Вызывается под l.mu.
func (l *Limiter) sweep(now time.Time) {
	if now.Before(l.nextSweep) {
		return
	}
	for key := range l.events {
		l.prune(key, now) // удалять из map во время range в Go разрешено
	}
	l.nextSweep = now.Add(l.rule.Window)
}
