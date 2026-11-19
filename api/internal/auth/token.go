package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
)

// NewToken возвращает случайный токен (32 байта из crypto/rand в base64url —
// безопасно для cookie и URL) и его SHA-256. Токен получает только клиент,
// в БД хранится хеш: утечка базы не даёт войти по чужой сессии.
func NewToken() (token string, hash []byte) {
	b := make([]byte, 32)
	_, _ = rand.Read(b) // crypto/rand.Read не возвращает ошибок (Go 1.24+)
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, HashToken(token)
}

// HashToken — SHA-256 от строки токена. Медленный хеш (как для паролей) не нужен:
// у токена 256 бит случайности, перебирать его бессмысленно.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
