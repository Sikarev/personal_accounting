// Package config читает настройки приложения из переменных окружения.
package config

import (
	"fmt"
	"net/netip"
	"os"
	"strconv"
	"strings"
)

// Окружения, в которых может работать приложение (переменная APP_ENV).
const (
	EnvDevelopment = "development"
	EnvProduction  = "production"
)

type Config struct {
	Env         string // APP_ENV: "development" (по умолчанию) или "production"
	Addr        string // адрес HTTP-сервера, например ":8080"
	DatabaseURL string

	// CookieSecure — флаг Secure у cookie сессии (COOKIE_SECURE).
	// По умолчанию включён в production и выключен в development:
	// локально API работает по http, и браузер не отправил бы Secure-cookie
	// при открытии с телефона по адресу в локальной сети.
	CookieSecure bool
	// TrustedProxies — адреса обратных прокси, которым доверяем X-Forwarded-For
	// (TRUSTED_PROXIES: CIDR или отдельные IP через запятую). По умолчанию пусто:
	// заголовок игнорируется, клиент — адрес соединения.
	TrustedProxies []netip.Prefix
	// CSRFTrustedOrigins — дополнительные origin (CSRF_TRUSTED_ORIGINS, через
	// запятую, например "http://localhost:5173"), с которых разрешены запросы,
	// меняющие данные. Обычно не нужен: страница и API на одном origin.
	CSRFTrustedOrigins []string
}

// Load возвращает конфигурацию. Значения по умолчанию совпадают
// с docker-compose.yml, поэтому локально ничего настраивать не нужно.
func Load() (Config, error) {
	cfg := Config{
		Env:                getEnv("APP_ENV", EnvDevelopment),
		Addr:               getEnv("API_ADDR", ":8080"),
		DatabaseURL:        getEnv("DATABASE_URL", "postgres://pa:pa_dev_password@localhost:5432/pa?sslmode=disable"),
		CSRFTrustedOrigins: splitList(os.Getenv("CSRF_TRUSTED_ORIGINS")),
	}

	cfg.CookieSecure = cfg.IsProduction()
	if v := os.Getenv("COOKIE_SECURE"); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return Config{}, fmt.Errorf("COOKIE_SECURE: ожидается true или false, получено %q", v)
		}
		cfg.CookieSecure = b
	}

	proxies, err := ParsePrefixes(os.Getenv("TRUSTED_PROXIES"))
	if err != nil {
		return Config{}, fmt.Errorf("TRUSTED_PROXIES: %w", err)
	}
	cfg.TrustedProxies = proxies
	return cfg, nil
}

// IsProduction сообщает, запущено ли приложение в боевом окружении.
func (c Config) IsProduction() bool {
	return c.Env == EnvProduction
}

// ParsePrefixes разбирает список CIDR через запятую. Отдельный IP без маски
// означает ровно этот адрес (/32 для IPv4, /128 для IPv6).
func ParsePrefixes(s string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, item := range splitList(s) {
		if strings.Contains(item, "/") {
			p, err := netip.ParsePrefix(item)
			if err != nil {
				return nil, fmt.Errorf("%q: %w", item, err)
			}
			out = append(out, p.Masked())
			continue
		}
		a, err := netip.ParseAddr(item)
		if err != nil {
			return nil, fmt.Errorf("%q: %w", item, err)
		}
		a = a.Unmap()
		out = append(out, netip.PrefixFrom(a, a.BitLen()))
	}
	return out, nil
}

// splitList разбивает строку по запятым, обрезает пробелы и пропускает пустые элементы.
func splitList(s string) []string {
	var out []string
	for item := range strings.SplitSeq(s, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return fallback
}
