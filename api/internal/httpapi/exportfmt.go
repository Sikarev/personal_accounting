package httpapi

import (
	"encoding/csv"
	"io"
	"strconv"
	"strings"
	"time"
)

// Форматирование ячеек CSV для Excel с русскими региональными настройками
// (docs/api.md → «Экспорт»). Чистые функции, без БД — тесты в exportfmt_test.go.

// utf8BOM — метка порядка байтов. По ней Excel понимает, что файл в UTF-8;
// без неё он читает CSV в кодировке системы (cp1251) и кириллица ломается.
const utf8BOM = "\ufeff"

// newCSVWriter пишет BOM и возвращает csv.Writer в формате Excel по-русски:
// разделитель «;» (запятая в русской локали — десятичный знак), строки через
// CRLF. Кавычки по RFC 4180 расставляет encoding/csv: поле с «;», кавычкой
// или переносом строки берётся в кавычки, кавычка внутри удваивается.
func newCSVWriter(w io.Writer) (*csv.Writer, error) {
	if _, err := io.WriteString(w, utf8BOM); err != nil {
		return nil, err
	}
	cw := csv.NewWriter(w)
	cw.Comma = ';'
	cw.UseCRLF = true
	return cw, nil
}

// formatMinor переводит сумму из минимальных единиц в основные с десятичной
// запятой и без разделителя разрядов: 123450 при minorUnits = 2 → «1234,50»,
// −5 → «-0,05», 7 при minorUnits = 0 → «7». Только целочисленная арифметика
// над строкой цифр — никаких float.
func formatMinor(v int64, minorUnits int) string {
	// Модуль через uint64: -uint64(v) — дополнение до двух, оно верно и для
	// math.MinInt64, у которого нет положительной пары в int64.
	u := uint64(v)
	if v < 0 {
		u = -u
	}
	s := strconv.FormatUint(u, 10)
	if minorUnits > 0 {
		if len(s) <= minorUnits { // 5 копеек → «005» → «0,05»
			s = strings.Repeat("0", minorUnits-len(s)+1) + s
		}
		s = s[:len(s)-minorUnits] + "," + s[len(s)-minorUnits:]
	}
	if v < 0 {
		s = "-" + s
	}
	return s
}

// formatExportDate — дата в виде ДД.ММ.ГГГГ: такую строку Excel с русскими
// настройками сам распознаёт как дату.
func formatExportDate(d time.Time) string {
	return d.Format("02.01.2006")
}

// formatExportDateTime — момент времени в поясе loc: «ДД.ММ.ГГГГ ЧЧ:ММ».
func formatExportDateTime(t time.Time, loc *time.Location) string {
	return t.In(loc).Format("02.01.2006 15:04")
}

// csvText защищает текстовую ячейку от CSV injection: Excel считает
// формулой ячейку, начинающуюся с «=», «+», «-», «@» (а табуляцию и возврат
// каретки в начале некоторые программы отбрасывают, после чего формула
// срабатывает). Апостроф в начале Excel показывает как обычный текст.
// Применяется только к тексту пользователей (названия, комментарии, имена);
// числа и даты сервер формирует сам, их экранировать нельзя — «-100,00»
// перестал бы быть числом.
func csvText(s string) string {
	if s != "" && strings.IndexByte("=+-@\t\r", s[0]) >= 0 {
		return "'" + s
	}
	return s
}

// yesNo — логическое значение для ячейки.
func yesNo(b bool) string {
	if b {
		return "Да"
	}
	return "Нет"
}
