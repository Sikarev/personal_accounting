// Package config читает настройки приложения из переменных окружения.
package config

import (
	"errors"
	"fmt"
	"net/mail"
	"net/netip"
	"net/url"
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

	// AppBaseURL — адрес фронтенда без завершающего «/» (APP_BASE_URL), из него
	// собираются ссылки в письмах: AppBaseURL + "/verify-email?token=…".
	// В production обязателен: ссылка на localhost в письме бесполезна.
	AppBaseURL string
	// SMTP — сервер исходящей почты. Умолчания — Mailpit из docker-compose.yml.
	SMTP SMTP
	// MailFrom — отправитель писем (MAIL_FROM), например
	// "Домашняя бухгалтерия <no-reply@example.com>".
	MailFrom mail.Address

	// RatesSync — фоновая загрузка курсов ЦБ РФ в процессе API (RATES_SYNC,
	// по умолчанию включена). Выключают для работы без сети.
	RatesSync bool
	// CBRBaseURL — адрес XML-сервиса ЦБ без завершающего «/» (CBR_BASE_URL).
	// По умолчанию официальный; другой нужен только для проверки с заглушкой.
	CBRBaseURL string
}

// SMTP — настройки SMTP-сервера (SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD).
// Пустой Username — без входа (Mailpit входа не требует).
type SMTP struct {
	Host     string
	Port     string
	Username string
	Password string
}

const (
	defaultAppBaseURL = "http://localhost:5173"
	// defaultCBRBaseURL — официальный XML-сервис ЦБ РФ; неофициальные зеркала не используем.
	defaultCBRBaseURL = "https://www.cbr.ru/scripts"
)

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

	cfg.SMTP = SMTP{
		Host:     getEnv("SMTP_HOST", "localhost"),
		Port:     getEnv("SMTP_PORT", "1025"),
		Username: os.Getenv("SMTP_USERNAME"),
		Password: os.Getenv("SMTP_PASSWORD"),
	}
	from, err := mail.ParseAddress(getEnv("MAIL_FROM", "Домашняя бухгалтерия <no-reply@localhost>"))
	if err != nil {
		return Config{}, fmt.Errorf("MAIL_FROM: %w", err)
	}
	cfg.MailFrom = *from

	baseURL := os.Getenv("APP_BASE_URL")
	if baseURL == "" {
		if cfg.IsProduction() {
			return Config{}, errors.New("APP_BASE_URL обязателен в production: из него собираются ссылки в письмах")
		}
		baseURL = defaultAppBaseURL
	}
	if cfg.AppBaseURL, err = parseBaseURL(baseURL); err != nil {
		return Config{}, fmt.Errorf("APP_BASE_URL: %w", err)
	}

	cfg.RatesSync = true
	if v := os.Getenv("RATES_SYNC"); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return Config{}, fmt.Errorf("RATES_SYNC: ожидается true или false, получено %q", v)
		}
		cfg.RatesSync = b
	}
	if cfg.CBRBaseURL, err = parseBaseURL(getEnv("CBR_BASE_URL", defaultCBRBaseURL)); err != nil {
		return Config{}, fmt.Errorf("CBR_BASE_URL: %w", err)
	}
	return cfg, nil
}

// parseBaseURL проверяет, что s — абсолютный http(s)-адрес без query и fragment,
// и убирает завершающий «/», чтобы к нему можно было дописать путь.
func parseBaseURL(s string) (string, error) {
	u, err := url.Parse(s)
	if err != nil {
		return "", err
	}
	if (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("ожидается адрес вида https://example.com, получено %q", s)
	}
	return strings.TrimRight(s, "/"), nil
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
