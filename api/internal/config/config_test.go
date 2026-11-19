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
		cfg, err := Load()
		if (err != nil) != c.wantErr {
			t.Fatalf("%+v: ошибка %v", c, err)
		}
		if err == nil && cfg.CookieSecure != c.want {
			t.Fatalf("%+v: CookieSecure = %v", c, cfg.CookieSecure)
		}
	}
}
