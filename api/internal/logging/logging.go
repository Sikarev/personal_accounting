// Package logging создаёт логгер приложения на базе стандартного log/slog.
package logging

import (
	"io"
	"log/slog"
)

// New возвращает логгер: JSON в production (его удобно разбирать сборщикам логов),
// читаемый текст key=value — в разработке.
func New(w io.Writer, production bool) *slog.Logger {
	opts := &slog.HandlerOptions{Level: slog.LevelInfo}
	if production {
		return slog.New(slog.NewJSONHandler(w, opts))
	}
	return slog.New(slog.NewTextHandler(w, opts))
}
