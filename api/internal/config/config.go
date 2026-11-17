// Package config читает настройки приложения из переменных окружения.
package config

import "os"

// Окружения, в которых может работать приложение (переменная APP_ENV).
const (
	EnvDevelopment = "development"
	EnvProduction  = "production"
)

type Config struct {
	Env         string // APP_ENV: "development" (по умолчанию) или "production"
	Addr        string // адрес HTTP-сервера, например ":8080"
	DatabaseURL string
}

// Load возвращает конфигурацию. Значения по умолчанию совпадают
// с docker-compose.yml, поэтому локально ничего настраивать не нужно.
func Load() Config {
	return Config{
		Env:         getEnv("APP_ENV", EnvDevelopment),
		Addr:        getEnv("API_ADDR", ":8080"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://pa:pa_dev_password@localhost:5432/pa?sslmode=disable"),
	}
}

// IsProduction сообщает, запущено ли приложение в боевом окружении.
func (c Config) IsProduction() bool {
	return c.Env == EnvProduction
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
