package httpapi

import (
	"bytes"
	"math"
	"testing"
	"time"
)

func TestFormatMinor(t *testing.T) {
	cases := []struct {
		v    int64
		mu   int
		want string
	}{
		{0, 2, "0,00"},
		{5, 2, "0,05"},
		{-5, 2, "-0,05"},
		{50, 2, "0,50"},
		{100, 2, "1,00"},
		{123450, 2, "1234,50"},
		{-123450, 2, "-1234,50"},
		{1234567890123, 2, "12345678901,23"}, // без разделителя разрядов
		{7, 0, "7"},
		{-7, 0, "-7"},
		{0, 0, "0"},
		{1, 3, "0,001"},
		{12345, 3, "12,345"},
		{math.MaxInt64, 2, "92233720368547758,07"},
		{math.MinInt64, 2, "-92233720368547758,08"},
	}
	for _, c := range cases {
		if got := formatMinor(c.v, c.mu); got != c.want {
			t.Errorf("formatMinor(%d, %d) = %q, want %q", c.v, c.mu, got, c.want)
		}
	}
}

func TestFormatExportDates(t *testing.T) {
	if got := formatExportDate(time.Date(2026, 3, 5, 0, 0, 0, 0, time.UTC)); got != "05.03.2026" {
		t.Errorf("дата: %q", got)
	}
	msk, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	// 21:30 UTC — уже следующий день в Москве (UTC+3).
	got := formatExportDateTime(time.Date(2026, 12, 31, 21, 30, 0, 0, time.UTC), msk)
	if got != "01.01.2027 00:30" {
		t.Errorf("момент времени: %q", got)
	}
}

func TestCSVText(t *testing.T) {
	cases := map[string]string{
		"":                  "",
		"Продукты":          "Продукты",
		"=1+1":              "'=1+1",
		"+7 999":            "'+7 999",
		"-5":                "'-5",
		"@SUM(A1)":          "'@SUM(A1)",
		"\tэ":               "'\tэ",
		"\rэ":               "'\rэ",
		" =1":               " =1", // не в начале — не формула
		"a=1":               "a=1",
		"'уже с апострофом": "'уже с апострофом",
	}
	for in, want := range cases {
		if got := csvText(in); got != want {
			t.Errorf("csvText(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestCSVWriterFormat — BOM, «;», CRLF и кавычки по RFC 4180.
func TestCSVWriterFormat(t *testing.T) {
	var buf bytes.Buffer
	cw, err := newCSVWriter(&buf)
	if err != nil {
		t.Fatal(err)
	}
	_ = cw.Write([]string{"a;b", `скажи "привет"`, "строка 1\nстрока 2", "-1234,50"})
	_ = cw.Write([]string{"", "x"})
	cw.Flush()
	if err := cw.Error(); err != nil {
		t.Fatal(err)
	}
	want := "\xEF\xBB\xBF" + `"a;b";"скажи ""привет""";"строка 1` + "\r\n" + `строка 2";-1234,50` + "\r\n" + ";x\r\n"
	if got := buf.String(); got != want {
		t.Errorf("CSV:\n got %q\nwant %q", got, want)
	}
}
