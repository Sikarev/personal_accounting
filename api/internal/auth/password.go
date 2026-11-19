// Package auth — криптография входа: хеширование паролей (argon2id)
// и токены сессий. HTTP и БД здесь не используются.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Параметры argon2id — рекомендация OWASP (Password Storage Cheat Sheet):
// 19 МиБ памяти, 2 прохода, 1 поток. Они записываются в сам хеш (PHC-строку),
// поэтому их можно поменять позже: старые хеши проверяются со своими параметрами.
const (
	argonMemoryKiB = 19456
	argonTime      = 2
	argonThreads   = 1
	argonSaltLen   = 16
	argonKeyLen    = 32
)

// ErrMalformedHash — строка из БД не похожа на хеш argon2id. Это ошибка
// данных (или будущий алгоритм, о котором код не знает), а не неверный пароль.
var ErrMalformedHash = errors.New("auth: неизвестный формат хеша пароля")

// b64 — base64 без выравнивания «=», как принято в PHC-строках.
var b64 = base64.RawStdEncoding

// HashPassword возвращает хеш в формате PHC:
//
//	$argon2id$v=19$m=19456,t=2,p=1$<соль>$<хеш>
func HashPassword(password string) string {
	salt := make([]byte, argonSaltLen)
	_, _ = rand.Read(salt) // crypto/rand.Read не возвращает ошибок (Go 1.24+)
	return encodeHash(password, salt, argonMemoryKiB, argonTime, argonThreads)
}

func encodeHash(password string, salt []byte, memory, time uint32, threads uint8) string {
	key := argon2.IDKey([]byte(password), salt, time, memory, threads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, memory, time, threads, b64.EncodeToString(salt), b64.EncodeToString(key))
}

// VerifyPassword сравнивает пароль с PHC-хешем. Параметры берутся из хеша.
// Неверный пароль — (false, nil); ошибка — только если хеш не разобрать.
func VerifyPassword(encoded, password string) (bool, error) {
	h, err := parseHash(encoded)
	if err != nil {
		return false, err
	}
	key := argon2.IDKey([]byte(password), h.salt, h.time, h.memory, h.threads, uint32(len(h.key)))
	// ConstantTimeCompare сравнивает за время, не зависящее от того, в каком
	// байте первое расхождение: по времени ответа хеш не подобрать.
	return subtle.ConstantTimeCompare(key, h.key) == 1, nil
}

type argonHash struct {
	memory, time uint32
	threads      uint8
	salt, key    []byte
}

func parseHash(encoded string) (argonHash, error) {
	// "$argon2id$v=19$m=..,t=..,p=..$соль$хеш" → ["", "argon2id", "v=19", "m=..", "соль", "хеш"]
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[0] != "" || parts[1] != "argon2id" {
		return argonHash{}, ErrMalformedHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return argonHash{}, ErrMalformedHash
	}
	var h argonHash
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &h.memory, &h.time, &h.threads); err != nil {
		return argonHash{}, ErrMalformedHash
	}
	// Границы защищают от испорченной строки в БД, из-за которой проверка
	// пароля съела бы гигабайты памяти.
	if h.memory < 1024 || h.memory > 1<<20 || h.time < 1 || h.time > 16 || h.threads < 1 || h.threads > 16 {
		return argonHash{}, ErrMalformedHash
	}
	var err error
	if h.salt, err = b64.DecodeString(parts[4]); err != nil || len(h.salt) < 8 {
		return argonHash{}, ErrMalformedHash
	}
	if h.key, err = b64.DecodeString(parts[5]); err != nil || len(h.key) < 16 || len(h.key) > 64 {
		return argonHash{}, ErrMalformedHash
	}
	return h, nil
}
