// Package db объединяет работу с БД: SQL-запросы лежат в queries/,
// а сгенерированный по ним sqlc код — в подпакете dbgen.
// Руками dbgen не правим: меняем .sql и запускаем go generate ./...
package db

//go:generate go tool sqlc generate -f ../../sqlc.yaml
