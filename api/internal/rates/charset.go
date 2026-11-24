package rates

import (
	"bytes"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

// ЦБ отдаёт XML в windows-1251, а encoding/xml понимает только UTF-8:
// для других кодировок нужен CharsetReader. Готовый декодер есть в
// golang.org/x/text, но ради одной однобайтовой таблицы зависимость
// не нужна — таблица ниже короче, чем код подключения.

// cp1251High — символы для байтов 0x80–0xBF. Байты 0xC0–0xFF — это
// подряд идущие «А»…«я» (U+0410…U+044F), их считаем формулой.
// 0x98 в windows-1251 не определён — U+FFFD (символ замены).
var cp1251High = [64]rune{
	'Ђ', 'Ѓ', '‚', 'ѓ', '„', '…', '†', '‡', '€', '‰', 'Љ', '‹', 'Њ', 'Ќ', 'Ћ', 'Џ', // 0x80
	'ђ', '‘', '’', '“', '”', '•', '–', '—', utf8.RuneError, '™', 'љ', '›', 'њ', 'ќ', 'ћ', 'џ', // 0x90
	' ', 'Ў', 'ў', 'Ј', '¤', 'Ґ', '¦', '§', 'Ё', '©', 'Є', '«', '¬', '­', '®', 'Ї', // 0xA0
	'°', '±', 'І', 'і', 'ґ', 'µ', '¶', '·', 'ё', '№', 'є', '»', 'ј', 'Ѕ', 'ѕ', 'ї', // 0xB0
}

// decodeCP1251 переводит текст из windows-1251 в UTF-8.
func decodeCP1251(b []byte) []byte {
	out := make([]byte, 0, len(b)*2)
	for _, c := range b {
		switch {
		case c < 0x80:
			out = append(out, c) // ASCII совпадает
		case c < 0xC0:
			out = utf8.AppendRune(out, cp1251High[c-0x80])
		default:
			out = utf8.AppendRune(out, 'А'+rune(c-0xC0))
		}
	}
	return out
}

// charsetReader — CharsetReader для xml.Decoder: label — значение encoding
// из заголовка <?xml ...?>. Ответ ЦБ небольшой (история валюты за 26 лет —
// около 800 КБ), поэтому читаем его целиком, а не потоком.
func charsetReader(label string, input io.Reader) (io.Reader, error) {
	switch strings.ToLower(label) {
	case "windows-1251", "cp1251":
		b, err := io.ReadAll(input)
		if err != nil {
			return nil, err
		}
		return bytes.NewReader(decodeCP1251(b)), nil
	case "utf-8", "utf8":
		return input, nil
	}
	return nil, fmt.Errorf("неизвестная кодировка %q", label)
}
