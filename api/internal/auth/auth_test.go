package auth

import (
	"bytes"
	"strings"
	"testing"
)

func TestHashAndVerifyPassword(t *testing.T) {
	h := HashPassword("correct horse")
	if !strings.HasPrefix(h, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("неожиданный формат хеша: %s", h)
	}
	if h == HashPassword("correct horse") {
		t.Fatal("у одинаковых паролей одинаковый хеш: соль не случайна")
	}

	ok, err := VerifyPassword(h, "correct horse")
	if err != nil || !ok {
		t.Fatalf("верный пароль не принят: %v %v", ok, err)
	}
	ok, err = VerifyPassword(h, "correct horsE")
	if err != nil || ok {
		t.Fatalf("неверный пароль принят: %v %v", ok, err)
	}
}

// Параметры читаются из самого хеша: хеш со старыми параметрами проверяется
// и после того, как константы поменяют.
func TestVerifyUsesParamsFromHash(t *testing.T) {
	h := encodeHash("password", []byte("0123456789abcdef"), 1024, 1, 1)
	ok, err := VerifyPassword(h, "password")
	if err != nil || !ok {
		t.Fatalf("хеш с другими параметрами не проверяется: %v %v", ok, err)
	}
}

func TestVerifyRejectsMalformedHash(t *testing.T) {
	for _, h := range []string{
		"",
		"plain",
		"$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA",
		"$argon2id$v=16$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA",
		"$argon2id$v=19$m=99999999,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA",
		"$argon2id$v=19$m=19456,t=2,p=1$!!!$aGFzaGhhc2hoYXNoaGFzaA",
	} {
		if _, err := VerifyPassword(h, "x"); err != ErrMalformedHash {
			t.Errorf("%q: ошибка %v, ожидалась ErrMalformedHash", h, err)
		}
	}
}

func TestNewToken(t *testing.T) {
	tok, hash := NewToken()
	if len(tok) != 43 || strings.ContainsAny(tok, "+/=") {
		t.Fatalf("токен не base64url от 32 байт: %q", tok)
	}
	if !bytes.Equal(hash, HashToken(tok)) || len(hash) != 32 {
		t.Fatal("хеш токена не совпадает с HashToken")
	}
	if tok2, _ := NewToken(); tok2 == tok {
		t.Fatal("два токена совпали")
	}
}
