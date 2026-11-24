package rates

import (
	"os"
	"strings"
	"testing"
	"time"
)

// Образцы в testdata — настоящие ответы www.cbr.ru/scripts в исходной
// кодировке windows-1251 (.gitattributes: -text, чтобы git их не трогал).

func openTestdata(t *testing.T, name string) *os.File {
	t.Helper()
	f, err := os.Open("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Close() })
	return f
}

func date(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func TestDecodeCP1251(t *testing.T) {
	// Эталон для 0x80–0xFF (без неопределённого 0x98) получен iconv -f cp1251.
	const want = "ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕї" +
		"АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя"
	var in []byte
	for c := 0x80; c <= 0xFF; c++ {
		if c != 0x98 {
			in = append(in, byte(c))
		}
	}
	if got := string(decodeCP1251(in)); got != want {
		t.Fatalf("got  %q\nwant %q", got, want)
	}
	if got := string(decodeCP1251([]byte("USD <a>\x98"))); got != "USD <a>�" {
		t.Fatalf("ASCII и 0x98: %q", got)
	}
	// «Доллар США» в windows-1251 — так он записан в образце daily.
	if got := string(decodeCP1251([]byte("\xc4\xee\xeb\xeb\xe0\xf0 \xd1\xd8\xc0"))); got != "Доллар США" {
		t.Fatalf("кириллица: %q", got)
	}
}

func TestParseDailySample(t *testing.T) {
	d, err := ParseDaily(openTestdata(t, "daily_2024-03-02.xml"))
	if err != nil {
		t.Fatal(err)
	}
	if !d.Date.Equal(date(2024, 3, 2)) {
		t.Fatalf("дата %v", d.Date)
	}
	if len(d.Valutes) != 43 {
		t.Fatalf("валют %d", len(d.Valutes))
	}
	byCode := map[string]DailyValute{}
	for _, v := range d.Valutes {
		byCode[v.CharCode] = v
	}
	for _, c := range []struct {
		code, id string
		nominal  int32
		value    string
	}{
		{"USD", "R01235", 1, "91.3336"},
		{"EUR", "R01239", 1, "98.7225"},
		{"JPY", "R01820", 100, "60.7271"}, // номинал 100: курс за 1 иену — 0,607271
		{"AZN", "R01020A", 1, "53.7256"},  // id с буквой — берём как есть
	} {
		v, ok := byCode[c.code]
		if !ok {
			t.Fatalf("%s нет в образце", c.code)
		}
		if v.ID != c.id || v.Rate.Nominal != c.nominal || v.Rate.Value != c.value || !v.Rate.Date.Equal(d.Date) {
			t.Fatalf("%s: %+v", c.code, v)
		}
	}
}

func TestParseDynamicSamples(t *testing.T) {
	usd, err := ParseDynamic(openTestdata(t, "dynamic_usd_2024-02.xml"), "R01235")
	if err != nil {
		t.Fatal(err)
	}
	// Запрошено 26.02–06.03. Курса на понедельник 26.02 нет: курс, установленный
	// на субботу 24.02, действует до вторника; так же нет 03–04.03.
	// Пропуски не заполняются, «ближайший предыдущий» — правило чтения.
	wantDates := []time.Time{date(2024, 2, 27), date(2024, 2, 28), date(2024, 2, 29),
		date(2024, 3, 1), date(2024, 3, 2), date(2024, 3, 5), date(2024, 3, 6)}
	if len(usd) != len(wantDates) {
		t.Fatalf("записей %d", len(usd))
	}
	for i, r := range usd {
		if !r.Date.Equal(wantDates[i]) || r.Nominal != 1 {
			t.Fatalf("запись %d: %+v", i, r)
		}
	}
	if usd[0].Value != "92.6321" || usd[6].Value != "91.1604" {
		t.Fatalf("%+v", usd)
	}

	jpy, err := ParseDynamic(openTestdata(t, "dynamic_jpy_2024-02.xml"), "R01820")
	if err != nil {
		t.Fatal(err)
	}
	if len(jpy) != 7 || jpy[0].Nominal != 100 || jpy[0].Value != "61.6274" {
		t.Fatalf("%+v", jpy)
	}

	empty, err := ParseDynamic(openTestdata(t, "dynamic_empty.xml"), "R99999")
	if err != nil || len(empty) != 0 {
		t.Fatalf("пустая история: %v, %+v", err, empty)
	}
}

func TestParseErrors(t *testing.T) {
	// Ответ ЦБ на неверные параметры: HTTP 200 и текст внутри ValCurs.
	if _, err := ParseDynamic(openTestdata(t, "error_params.xml"), "R01235"); err == nil ||
		!strings.Contains(err.Error(), "Error in parameters") {
		t.Fatalf("ошибка ЦБ: %v", err)
	}
	if _, err := ParseDaily(openTestdata(t, "error_params.xml")); err == nil {
		t.Fatal("ошибка ЦБ в daily принята")
	}
	// История другой валюты.
	if _, err := ParseDynamic(openTestdata(t, "dynamic_usd_2024-02.xml"), "R01239"); err == nil {
		t.Fatal("чужая история принята")
	}

	const head = `<?xml version="1.0" encoding="windows-1251"?>`
	for name, body := range map[string]string{
		"не XML": "<html>Service unavailable",
		"неизвестная кодировка": `<?xml version="1.0" encoding="koi8-r"?><ValCurs ID="R01235"/>`,
		"неверная дата":         head + `<ValCurs ID="R01235"><Record Date="31.02.2024" Id="R01235"><Nominal>1</Nominal><Value>1,5</Value></Record></ValCurs>`,
		"пустой курс":           head + `<ValCurs ID="R01235"><Record Date="01.02.2024" Id="R01235"><Nominal>1</Nominal><Value></Value></Record></ValCurs>`,
		"нулевой курс":          head + `<ValCurs ID="R01235"><Record Date="01.02.2024" Id="R01235"><Nominal>1</Nominal><Value>0,0000</Value></Record></ValCurs>`,
		"отрицательный курс":    head + `<ValCurs ID="R01235"><Record Date="01.02.2024" Id="R01235"><Nominal>1</Nominal><Value>-92,5</Value></Record></ValCurs>`,
		"нулевой номинал":       head + `<ValCurs ID="R01235"><Record Date="01.02.2024" Id="R01235"><Nominal>0</Nominal><Value>92,5</Value></Record></ValCurs>`,
		"запись чужой валюты":   head + `<ValCurs ID="R01235"><Record Date="01.02.2024" Id="R01239"><Nominal>1</Nominal><Value>92,5</Value></Record></ValCurs>`,
	} {
		if _, err := ParseDynamic(strings.NewReader(body), "R01235"); err == nil {
			t.Errorf("%s: принято", name)
		}
	}
	if _, err := ParseDaily(strings.NewReader(head +
		`<ValCurs Date="02.03.2024"><Valute ID="R01235"><CharCode>USD</CharCode><Nominal>1</Nominal><Value>abc</Value></Valute></ValCurs>`)); err == nil {
		t.Error("мусор в daily принят")
	}
}

func TestParseDecimal(t *testing.T) {
	for in, want := range map[string]string{
		"92,1234":  "92.1234",
		"92.1234":  "92.1234",
		" 27 ":     "27",
		"0,616274": "0.616274",
		"0,0001":   "0.0001",
	} {
		got, err := parseDecimal(in)
		if err != nil || got != want {
			t.Errorf("%q: %q, %v", in, got, err)
		}
	}
	for _, in := range []string{
		"", " ", "0", "0,0000", "000", "-1,5", "+1,5", "abc", "1,2,3", "1,2.3", "1e5",
		"1,", ",5", "1 000,5", "92,12a", "١٢", "NaN", "Infinity",
		"1234567890123,5", // 13 знаков до запятой — не влезет в numeric(20, 8)
		"1,1234567890123", // 13 знаков после запятой
	} {
		if got, err := parseDecimal(in); err == nil {
			t.Errorf("%q принято как %q", in, got)
		}
	}
}

func TestParseRateNominal(t *testing.T) {
	for _, n := range []string{"", "0", "-10", "abc", "1,5", "10000000", "99999999999"} {
		if _, err := parseRate(date(2024, 1, 1), n, "92,5"); err == nil {
			t.Errorf("номинал %q принят", n)
		}
	}
	r, err := parseRate(date(2024, 1, 1), "10000", "1,2345")
	if err != nil || r.Nominal != 10000 || r.Value != "1.2345" {
		t.Fatalf("%+v, %v", r, err)
	}
}
