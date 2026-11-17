// Package config читает настройки приложения из переменных окружения.
package config

import "os"

type Config struct {
	Addr        string // адрес HTTP-сервера, например ":8080"
	DatabaseURL string
}

// Load возвращает конфигурацию. Значения по умолчанию совпадают
// с docker-compose.yml, поэтому локально ничего настраивать не нужно.
func Load() Config {
	return Config{
		Addr:        getEnv("API_ADDR", ":8080"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://pa:pa_dev_password@localhost:5432/pa?sslmode=disable"),
	}
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
