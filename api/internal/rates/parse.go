package rates

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

// cbrDate — формат дат в ответах ЦБ (атрибуты Date) и в параметрах запросов
// отличается только разделителем: «02.03.2024» и «02/03/2024».
const (
	cbrDate      = "02.01.2006"
	cbrQueryDate = "02/01/2006"
)

// Rate — курс валюты, установленный ЦБ на дату Date: Nominal единиц валюты
// стоят Value рублей. Value — десятичная строка с точкой («92.1234»): деньги
// и курсы не проходят через float, делит и округляет Postgres (numeric).
type Rate struct {
	Date    time.Time // полночь UTC, как date из БД
	Nominal int32
	Value   string
}

// Daily — ответ XML_daily.asp: валюты, которые ЦБ котирует на дату. Нужен
// только для сопоставления CharCode → ID; курсы из него не берутся
// и не проверяются — в БД пишется только история из XML_dynamic.asp.
type Daily struct {
	Date    time.Time
	Valutes []DailyValute
}

// DailyValute — одна валюта из XML_daily.asp. ID — внутренний код ЦБ
// (R01235 для USD), он нужен для запроса истории в XML_dynamic.asp.
type DailyValute struct {
	ID       string
	CharCode string
}

// Структуры, в которые encoding/xml раскладывает ответ. Теги вида
// `xml:"Date,attr"` — атрибут, `xml:"Valute"` — вложенный элемент,
// `xml:",chardata"` — текст внутри элемента (так ЦБ сообщает об ошибке:
// <ValCurs>Error in parameters</ValCurs>).
type xmlDaily struct {
	Date    string `xml:"Date,attr"`
	Text    string `xml:",chardata"`
	Valutes []struct {
		ID       string `xml:"ID,attr"`
		CharCode string `xml:"CharCode"`
	} `xml:"Valute"`
}

type xmlDynamic struct {
	ID      string `xml:"ID,attr"`
	Text    string `xml:",chardata"`
	Records []struct {
		Date    string `xml:"Date,attr"`
		ID      string `xml:"Id,attr"`
		Nominal string `xml:"Nominal"`
		Value   string `xml:"Value"`
	} `xml:"Record"`
}

// ParseDaily разбирает ответ XML_daily.asp. Курсы и номиналы в нём не
// проверяются: кривая запись чужой валюты (у ЦБ их около 55) не должна
// останавливать загрузку USD и EUR. Валюта без ID или CharCode пропускается.
func ParseDaily(r io.Reader) (Daily, error) {
	var x xmlDaily
	if err := decode(r, &x); err != nil {
		return Daily{}, err
	}
	if x.Date == "" {
		return Daily{}, cbrError(x.Text)
	}
	date, err := parseDate(x.Date)
	if err != nil {
		return Daily{}, err
	}
	out := Daily{Date: date, Valutes: make([]DailyValute, 0, len(x.Valutes))}
	for _, v := range x.Valutes {
		id, code := strings.TrimSpace(v.ID), strings.TrimSpace(v.CharCode)
		if id == "" || code == "" {
			continue
		}
		out.Valutes = append(out.Valutes, DailyValute{ID: id, CharCode: code})
	}
	return out, nil
}

// ParseDynamic разбирает ответ XML_dynamic.asp — историю курса валюты id.
// Пустой ответ (курсов за период нет) — не ошибка.
func ParseDynamic(r io.Reader, id string) ([]Rate, error) {
	var x xmlDynamic
	if err := decode(r, &x); err != nil {
		return nil, err
	}
	if x.ID == "" {
		return nil, cbrError(x.Text)
	}
	if x.ID != id {
		return nil, fmt.Errorf("ЦБ вернул историю валюты %q вместо %q", x.ID, id)
	}
	out := make([]Rate, 0, len(x.Records))
	for _, rec := range x.Records {
		if rec.ID != id {
			return nil, fmt.Errorf("запись валюты %q в истории %q", rec.ID, id)
		}
		date, err := parseDate(rec.Date)
		if err != nil {
			return nil, err
		}
		rate, err := parseRate(date, rec.Nominal, rec.Value)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", rec.Date, err)
		}
		out = append(out, rate)
	}
	return out, nil
}

func decode(r io.Reader, v any) error {
	d := xml.NewDecoder(r)
	d.CharsetReader = charsetReader
	if err := d.Decode(v); err != nil {
		return fmt.Errorf("разбор XML: %w", err)
	}
	return nil
}

// cbrError — ответ без ожидаемых атрибутов: ЦБ так сообщает об ошибке
// в параметрах. Текст обрезаем: в лог не должна попасть случайная страница целиком.
func cbrError(text string) error {
	text = strings.TrimSpace(text)
	if len(text) > 200 {
		text = text[:200]
	}
	if text == "" {
		return errors.New("ЦБ вернул неожиданный ответ")
	}
	return fmt.Errorf("ЦБ вернул ошибку: %q", text)
}

func parseDate(s string) (time.Time, error) {
	d, err := time.Parse(cbrDate, strings.TrimSpace(s))
	if err != nil {
		return time.Time{}, fmt.Errorf("дата %q: %w", s, err)
	}
	return d, nil
}

// Пределы, чтобы курс поместился в numeric(20, 8) (12 знаков до запятой)
// и чтобы мусор не дошёл до БД. Номинал у ЦБ — 1, 10, 100 … 10000.
const (
	maxIntDigits  = 12
	maxFracDigits = 12
	maxNominal    = 1_000_000
)

func parseRate(date time.Time, nominal, value string) (Rate, error) {
	n, err := strconv.ParseInt(strings.TrimSpace(nominal), 10, 32)
	if err != nil || n <= 0 || n > maxNominal {
		return Rate{}, fmt.Errorf("номинал %q: ожидается целое число от 1 до %d", nominal, maxNominal)
	}
	v, err := parseDecimal(value)
	if err != nil {
		return Rate{}, err
	}
	return Rate{Date: date, Nominal: int32(n), Value: v}, nil
}

// parseDecimal проверяет положительное десятичное число в записи ЦБ
// («92,1234»; точку тоже принимаем) и возвращает его с точкой — в таком
// виде Postgres приводит строку к numeric. Ноль, знак, пробелы внутри,
// экспонента и прочее отклоняются.
func parseDecimal(s string) (string, error) {
	s = strings.TrimSpace(s)
	intPart, frac, hasSep := strings.Cut(strings.Replace(s, ",", ".", 1), ".")
	if !isDigits(intPart) || len(intPart) > maxIntDigits ||
		(hasSep && (!isDigits(frac) || len(frac) > maxFracDigits)) {
		return "", fmt.Errorf("курс %q: ожидается положительное десятичное число", s)
	}
	if strings.Trim(intPart+frac, "0") == "" {
		return "", fmt.Errorf("курс %q: ноль", s)
	}
	if !hasSep {
		return intPart, nil
	}
	return intPart + "." + frac, nil
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
