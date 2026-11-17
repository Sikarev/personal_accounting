// Package migrations встраивает SQL-миграции в бинарник,
// чтобы для их запуска не нужны были файлы рядом с программой.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
