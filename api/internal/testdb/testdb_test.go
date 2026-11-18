package testdb

import (
	"strings"
	"testing"
	"time"
)

func TestIsStale(t *testing.T) {
	now := time.Date(2026, 11, 18, 12, 0, 0, 0, time.UTC)
	cases := map[string]bool{
		"pa_test_20261117_115959_1a2b3c4d": true,  // чуть больше суток
		"pa_test_20261117_120001_1a2b3c4d": false, // чуть меньше суток — может идти прогон
		"pa_test_20261118_115000_1a2b3c4d": false,
		"pa_test_garbage":                  false, // не наш формат — не трогаем
		"pa":                               false,
		"other_20200101_000000":            false,
	}
	for name, want := range cases {
		if got := isStale(name, now); got != want {
			t.Errorf("isStale(%q) = %v, ожидалось %v", name, got, want)
		}
	}
	if isStale(randomName(), time.Now()) {
		t.Error("только что созданное имя считается устаревшим")
	}
}

func TestDescribeHidesPassword(t *testing.T) {
	for _, dsn := range []string{
		"postgres://pa:topsecret@db.local:5433/pa?sslmode=disable",
		"host=db.local port=5433 user=pa password=topsecret dbname=pa sslmode=disable",
	} {
		got := describe(dsn)
		if strings.Contains(got, "topsecret") {
			t.Errorf("пароль в описании: %s", got)
		}
		if got != "host=db.local port=5433 user=pa database=pa" {
			t.Errorf("describe(%q) = %q", dsn, got)
		}
	}
}
