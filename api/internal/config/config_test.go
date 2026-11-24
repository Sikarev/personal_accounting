package config

import (
	"net/netip"
	"reflect"
	"testing"
)

func TestParsePrefixes(t *testing.T) {
	got, err := ParsePrefixes(" 10.0.0.0/8, 192.168.1.7 ,, fd00::/8,10.1.2.3/16")
	if err != nil {
		t.Fatal(err)
	}
	want := []netip.Prefix{
		netip.MustParsePrefix("10.0.0.0/8"),
		netip.MustParsePrefix("192.168.1.7/32"),
		netip.MustParsePrefix("fd00::/8"),
		netip.MustParsePrefix("10.1.0.0/16"), // маска применена
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%v", got)
	}
	if _, err := ParsePrefixes("10.0.0.0/33"); err == nil {
		t.Fatal("неверный CIDR принят")
	}
	if _, err := ParsePrefixes("proxy.local"); err == nil {
		t.Fatal("имя хоста принято вместо IP")
	}
}

func TestCookieSecureDefault(t *testing.T) {
	for _, c := range []struct {
		env, secure string
		want        bool
		wantErr     bool
	}{
		{EnvDevelopment, "", false, false},
		{EnvProduction, "", true, false},
		{EnvProduction, "false", false, false},
		{EnvDevelopment, "true", true, false},
		{EnvDevelopment, "maybe", false, true},
	} {
		t.Setenv("APP_ENV", c.env)
		t.Setenv("COOKIE_SECURE", c.secure)
		t.Setenv("TRUSTED_PROXIES", "")
		t.Setenv("APP_BASE_URL", "https://app.example.com")
		cfg, err := Load()
		if (err != nil) != c.wantErr {
			t.Fatalf("%+v: ошибка %v", c, err)
		}
		if err == nil && cfg.CookieSecure != c.want {
			t.Fatalf("%+v: CookieSecure = %v", c, cfg.CookieSecure)
		}
	}
}

func TestAppBaseURL(t *testing.T) {
	for _, c := range []struct {
		env, url, want string
		wantErr        bool
	}{
		{EnvDevelopment, "", "http://localhost:5173", false},
		{EnvProduction, "", "", true}, // в production обязателен
		{EnvProduction, "https://app.example.com/", "https://app.example.com", false},
		{EnvDevelopment, "http://192.168.1.5:5173", "http://192.168.1.5:5173", false},
		{EnvDevelopment, "app.example.com", "", true},
		{EnvDevelopment, "ftp://app.example.com", "", true},
		{EnvDevelopment, "https://app.example.com/?x=1", "", true},
	} {
		t.Setenv("APP_ENV", c.env)
		t.Setenv("APP_BASE_URL", c.url)
		t.Setenv("COOKIE_SECURE", "")
		t.Setenv("TRUSTED_PROXIES", "")
		cfg, err := Load()
		if (err != nil) != c.wantErr {
			t.Fatalf("%+v: ошибка %v", c, err)
		}
		if err == nil && cfg.AppBaseURL != c.want {
			t.Fatalf("%+v: AppBaseURL = %q", c, cfg.AppBaseURL)
		}
	}
}

func TestMailDefaults(t *testing.T) {
	for _, k := range []string{"APP_ENV", "SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "MAIL_FROM", "APP_BASE_URL", "COOKIE_SECURE", "TRUSTED_PROXIES"} {
		t.Setenv(k, "")
	}
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	// Умолчания — под Mailpit из docker-compose.yml.
	if cfg.SMTP != (SMTP{Host: "localhost", Port: "1025"}) {
		t.Fatalf("SMTP: %+v", cfg.SMTP)
	}
	if cfg.MailFrom.Name != "Домашняя бухгалтерия" || cfg.MailFrom.Address != "no-reply@localhost" {
		t.Fatalf("MAIL_FROM: %+v", cfg.MailFrom)
	}

	t.Setenv("MAIL_FROM", "not an address")
	if _, err := Load(); err == nil {
		t.Fatal("неверный MAIL_FROM принят")
	}
}

func TestRatesSettings(t *testing.T) {
	for _, c := range []struct {
		sync, url string
		wantSync  bool
		wantURL   string
		wantErr   bool
	}{
		{"", "", true, "https://www.cbr.ru/scripts", false},
		{"false", "", false, "https://www.cbr.ru/scripts", false},
		{"true", "http://127.0.0.1:9000/scripts/", true, "http://127.0.0.1:9000/scripts", false},
		{"maybe", "", false, "", true},
		{"", "www.cbr.ru", false, "", true},
	} {
		t.Setenv("APP_ENV", EnvDevelopment)
		t.Setenv("APP_BASE_URL", "")
		t.Setenv("COOKIE_SECURE", "")
		t.Setenv("TRUSTED_PROXIES", "")
		t.Setenv("RATES_SYNC", c.sync)
		t.Setenv("CBR_BASE_URL", c.url)
		cfg, err := Load()
		if (err != nil) != c.wantErr {
			t.Fatalf("%+v: ошибка %v", c, err)
		}
		if err == nil && (cfg.RatesSync != c.wantSync || cfg.CBRBaseURL != c.wantURL) {
			t.Fatalf("%+v: RatesSync = %v, CBRBaseURL = %q", c, cfg.RatesSync, cfg.CBRBaseURL)
		}
	}
}
