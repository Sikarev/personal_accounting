package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"personal-accounting/api/internal/mail"
	"personal-accounting/api/internal/ratelimit"
)

// mailsTo дожидается окончания фоновой отправки и возвращает письма на адрес to.
// Wait вместо time.Sleep: обработчик уже вернул ответ, значит, все письма
// этого запроса уже поставлены в отправку, и Wait дождётся именно их.
func (e authEnv) mailsTo(t *testing.T, to string) []mail.Message {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := e.mail.Wait(ctx); err != nil {
		t.Fatalf("письма не отправлены: %v", err)
	}
	var out []mail.Message
	for _, m := range e.mailbox.Messages() {
		if m.To == to {
			out = append(out, m)
		}
	}
	return out
}

var linkRe = regexp.MustCompile(`(https?://[^\s?]+)\?token=([A-Za-z0-9_-]+)`)

// lastLink — адрес страницы и токен из последнего письма на адрес to.
func (e authEnv) lastLink(t *testing.T, to string) (page, token string) {
	t.Helper()
	msgs := e.mailsTo(t, to)
	if len(msgs) == 0 {
		t.Fatalf("нет писем на %s", to)
	}
	m := linkRe.FindStringSubmatch(msgs[len(msgs)-1].Text)
	if m == nil {
		t.Fatalf("в письме нет ссылки: %s", msgs[len(msgs)-1].Text)
	}
	return m[1], m[2]
}

func tokenBody(token string) string { return `{"token":` + strconv.Quote(token) + `}` }

func confirmBody(token, password string) string {
	return `{"token":` + strconv.Quote(token) + `,"password":` + strconv.Quote(password) + `}`
}

func resetBody(email string) string { return `{"email":` + strconv.Quote(email) + `}` }

func (e authEnv) verifyEmail(token string) *httptest.ResponseRecorder {
	return e.send(http.MethodPost, "/api/v1/auth/verify-email", tokenBody(token))
}

func (e authEnv) requestReset(email string, opts ...reqOption) *httptest.ResponseRecorder {
	return e.send(http.MethodPost, "/api/v1/auth/password-reset", resetBody(email), opts...)
}

func (e authEnv) confirmReset(token, password string, opts ...reqOption) *httptest.ResponseRecorder {
	return e.send(http.MethodPost, "/api/v1/auth/password-reset/confirm", confirmBody(token, password), opts...)
}

func (e authEnv) resend(cookie *http.Cookie) *httptest.ResponseRecorder {
	if cookie == nil {
		return e.send(http.MethodPost, "/api/v1/auth/verify-email/resend", "")
	}
	return e.send(http.MethodPost, "/api/v1/auth/verify-email/resend", "", withCookie(cookie))
}

func (e authEnv) emailVerified(t *testing.T, cookie *http.Cookie) bool {
	t.Helper()
	rec := e.me(cookie)
	if rec.Code != http.StatusOK {
		t.Fatalf("/me: %d %s", rec.Code, rec.Body)
	}
	return decodeJSON(t, rec)["user"].(map[string]any)["emailVerified"].(bool)
}

func expectInvalidToken(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	body := decodeProblem(t, rec, http.StatusUnprocessableEntity, "validation_failed")
	if got := fieldErrors(t, body); len(got) != 1 || got[0] != "token:invalid_token" {
		t.Fatalf("ошибки полей: %v", got)
	}
}

func TestRegisterSendsVerificationAndVerify(t *testing.T) {
	e := newAuthEnv(t, Options{AppBaseURL: "https://app.example.com"})
	email := uniqueEmail()
	cookie, _ := e.register(t, email)

	msgs := e.mailsTo(t, email)
	if len(msgs) != 1 || msgs[0].Subject != "Подтвердите e-mail в Домашней бухгалтерии" ||
		!strings.Contains(msgs[0].Text, "Иван") || !strings.Contains(msgs[0].HTML, "Иван") {
		t.Fatalf("письмо: %+v", msgs)
	}
	page, token := e.lastLink(t, email)
	if page != "https://app.example.com/verify-email" {
		t.Fatalf("ссылка ведёт на %s", page)
	}
	if !strings.Contains(msgs[0].HTML, `href="https://app.example.com/verify-email?token=`+token+`"`) {
		t.Fatalf("ссылка в HTML: %s", msgs[0].HTML)
	}
	// В БД — только SHA-256 токена из письма (не сам токен и не обратимое
	// преобразование): единственный токен подтверждения пользователя совпадает
	// с хешем, и ни одна колонка строки не содержит токен.
	var stored []byte
	var row string
	if err := e.pool.QueryRow(context.Background(), `
		SELECT t.token_hash, t::text FROM email_tokens t JOIN users u ON u.id = t.user_id
		WHERE u.email = $1 AND t.purpose = 'verify_email'`, email).Scan(&stored, &row); err != nil {
		t.Fatal(err)
	}
	if want := sha256.Sum256([]byte(token)); !bytes.Equal(stored, want[:]) {
		t.Fatalf("token_hash = %x, ожидался SHA-256 токена %x", stored, want)
	}
	if strings.Contains(row, token) {
		t.Fatal("токен хранится в открытом виде")
	}
	if e.emailVerified(t, cookie) {
		t.Fatal("e-mail подтверждён до перехода по ссылке")
	}

	// Публичная операция: без cookie (ссылку открыли в другом браузере).
	if rec := e.verifyEmail(token); rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Fatalf("подтверждение: %d %s", rec.Code, rec.Body)
	}
	if !e.emailVerified(t, cookie) {
		t.Fatal("e-mail не подтверждён")
	}
	// Токен одноразовый.
	expectInvalidToken(t, e.verifyEmail(token))
	// Неизвестный токен.
	expectInvalidToken(t, e.verifyEmail("nonsense"))
}

func TestVerifyTokenExpires(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	e.register(t, email)
	_, token := e.lastLink(t, email)

	e.clock.Advance(verifyEmailTokenTTL)
	expectInvalidToken(t, e.verifyEmail(token))
}

func TestVerifyTokenStillValidBeforeExpiry(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	cookie, _ := e.register(t, email)
	_, token := e.lastLink(t, email)

	e.clock.Advance(verifyEmailTokenTTL - time.Second)
	if rec := e.verifyEmail(token); rec.Code != http.StatusNoContent {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if !e.emailVerified(t, cookie) {
		t.Fatal("e-mail не подтверждён")
	}
}

// Токен привязан к адресу: после смены адреса ссылки из старых писем не работают.
func TestTokensInvalidAfterEmailChange(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	cookie, _ := e.register(t, email)
	_, verifyToken := e.lastLink(t, email)
	e.requestReset(email)
	_, resetToken := e.lastLink(t, email)

	if _, err := e.pool.Exec(context.Background(), `UPDATE users SET email = $1 WHERE email = $2`, uniqueEmail(), email); err != nil {
		t.Fatal(err)
	}
	expectInvalidToken(t, e.verifyEmail(verifyToken))
	expectInvalidToken(t, e.confirmReset(resetToken, "new password 123"))
	if e.emailVerified(t, cookie) {
		t.Fatal("новый адрес подтверждён по ссылке для старого")
	}
}

// Токен одного назначения не подходит для другого.
func TestTokenPurposeIsChecked(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	e.register(t, email)
	_, verifyToken := e.lastLink(t, email)
	e.requestReset(email)
	_, resetToken := e.lastLink(t, email)

	expectInvalidToken(t, e.confirmReset(verifyToken, "new password 123"))
	expectInvalidToken(t, e.verifyEmail(resetToken))

	// Оба токена после неудачных попыток по-прежнему работают по назначению.
	if rec := e.verifyEmail(verifyToken); rec.Code != http.StatusNoContent {
		t.Fatalf("подтверждение: %d %s", rec.Code, rec.Body)
	}
	if rec := e.confirmReset(resetToken, "new password 123"); rec.Code != http.StatusOK {
		t.Fatalf("сброс: %d %s", rec.Code, rec.Body)
	}
}

func TestNewTokenRevokesPrevious(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	cookie, _ := e.register(t, email)
	_, first := e.lastLink(t, email)

	if rec := e.resend(cookie); rec.Code != http.StatusNoContent {
		t.Fatalf("resend: %d %s", rec.Code, rec.Body)
	}
	_, second := e.lastLink(t, email)
	if first == second {
		t.Fatal("токен не сменился")
	}
	expectInvalidToken(t, e.verifyEmail(first))
	if rec := e.verifyEmail(second); rec.Code != http.StatusNoContent {
		t.Fatalf("новый токен: %d %s", rec.Code, rec.Body)
	}

	// То же для сброса пароля.
	e.requestReset(email)
	_, r1 := e.lastLink(t, email)
	e.requestReset(email)
	_, r2 := e.lastLink(t, email)
	expectInvalidToken(t, e.confirmReset(r1, "new password 123"))
	if rec := e.confirmReset(r2, "new password 123"); rec.Code != http.StatusOK {
		t.Fatalf("сброс: %d %s", rec.Code, rec.Body)
	}
}

func TestResendVerification(t *testing.T) {
	e := newAuthEnv(t, Options{})

	// Без сессии — 401.
	decodeProblem(t, e.resend(nil), http.StatusUnauthorized, "unauthorized")

	email := uniqueEmail()
	cookie, _ := e.register(t, email)
	if rec := e.resend(cookie); rec.Code != http.StatusNoContent {
		t.Fatalf("resend: %d %s", rec.Code, rec.Body)
	}
	msgs := e.mailsTo(t, email)
	if len(msgs) != 2 || msgs[1].Subject != msgs[0].Subject {
		t.Fatalf("писем: %d", len(msgs))
	}

	_, token := e.lastLink(t, email)
	e.verifyEmail(token)
	// E-mail подтверждён: 204, но письма нет (и лимит не мешает).
	e.clock.Advance(time.Minute)
	for range 3 {
		if rec := e.resend(cookie); rec.Code != http.StatusNoContent {
			t.Fatalf("resend после подтверждения: %d %s", rec.Code, rec.Body)
		}
	}
	if n := len(e.mailsTo(t, email)); n != 2 {
		t.Fatalf("писем после подтверждения: %d", n)
	}
}

func TestResendRateLimits(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	cookie, _ := e.register(t, email)

	if rec := e.resend(cookie); rec.Code != http.StatusNoContent {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	// Не чаще раза в минуту.
	e.clock.Advance(30 * time.Second)
	rec := e.resend(cookie)
	decodeProblem(t, rec, http.StatusTooManyRequests, "too_many_requests")
	if ra := rec.Header().Get("Retry-After"); ra != "30" {
		t.Fatalf("Retry-After = %q", ra)
	}
	// Другой пользователь не затронут.
	other := uniqueEmail()
	otherCookie, _ := e.register(t, other)
	if rec := e.resend(otherCookie); rec.Code != http.StatusNoContent {
		t.Fatalf("другой пользователь: %d", rec.Code)
	}

	// Не больше 5 в час: ещё 4 с интервалом в минуту, шестое — 429.
	for range 4 {
		e.clock.Advance(time.Minute)
		if rec := e.resend(cookie); rec.Code != http.StatusNoContent {
			t.Fatalf("%d %s", rec.Code, rec.Body)
		}
	}
	e.clock.Advance(time.Minute)
	rec = e.resend(cookie)
	decodeProblem(t, rec, http.StatusTooManyRequests, "too_many_requests")
	if ra, _ := strconv.Atoi(rec.Header().Get("Retry-After")); ra <= 60 {
		t.Fatalf("Retry-After = %d, ожидалось ожидание часового окна", ra)
	}
	// 1 письмо при регистрации + 5 повторных.
	if n := len(e.mailsTo(t, email)); n != 6 {
		t.Fatalf("писем: %d", n)
	}

	e.clock.Advance(time.Hour)
	if rec := e.resend(cookie); rec.Code != http.StatusNoContent {
		t.Fatalf("после окна: %d %s", rec.Code, rec.Body)
	}
}

// Ответ на запрос сброса не выдаёт, есть ли аккаунт.
func TestPasswordResetResponseIsTheSame(t *testing.T) {
	e := newAuthEnv(t, Options{})
	existing := uniqueEmail()
	e.register(t, existing)
	missing := uniqueEmail()

	a := e.requestReset(strings.ToUpper(existing))
	b := e.requestReset(missing)
	if a.Code != http.StatusAccepted || b.Code != http.StatusAccepted {
		t.Fatalf("статусы: %d %d", a.Code, b.Code)
	}
	if a.Body.String() != b.Body.String() || a.Body.Len() != 0 {
		t.Fatalf("тела: %q %q", a.Body, b.Body)
	}
	// Заголовки совпадают, кроме X-Request-Id.
	ha, hb := a.Header().Clone(), b.Header().Clone()
	ha.Del("X-Request-Id")
	hb.Del("X-Request-Id")
	if !headersEqual(ha, hb) {
		t.Fatalf("заголовки: %v / %v", ha, hb)
	}

	if msgs := e.mailsTo(t, existing); len(msgs) != 2 || msgs[1].Subject != "Восстановление пароля в Домашней бухгалтерии" {
		t.Fatalf("письма существующему: %+v", msgs)
	}
	if msgs := e.mailsTo(t, missing); len(msgs) != 0 {
		t.Fatalf("письмо несуществующему: %+v", msgs)
	}
}

func headersEqual(a, b http.Header) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if strings.Join(v, "\n") != strings.Join(b[k], "\n") {
			return false
		}
	}
	return true
}

func TestPasswordResetFullCycle(t *testing.T) {
	e := newAuthEnv(t, Options{AppBaseURL: "https://app.example.com"})
	email := uniqueEmail()
	cookie1, _ := e.register(t, email)
	// Вторая сессия — вход с другого устройства.
	rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, testPassword))
	cookie2 := mustSessionCookie(t, rec)

	if rec := e.requestReset(email); rec.Code != http.StatusAccepted {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	page, token := e.lastLink(t, email)
	if page != "https://app.example.com/reset-password" {
		t.Fatalf("ссылка ведёт на %s", page)
	}

	const newPassword = "brand new password"
	rec = e.confirmReset(token, newPassword)
	if rec.Code != http.StatusOK {
		t.Fatalf("сброс: %d %s", rec.Code, rec.Body)
	}
	body := decodeJSON(t, rec)
	user := body["user"].(map[string]any)
	if user["email"] != email || user["emailVerified"] != true || body["family"].(map[string]any)["role"] != "owner" {
		t.Fatalf("ответ: %s", rec.Body)
	}
	cookie3 := mustSessionCookie(t, rec)

	// Все прежние сессии завершены, новая работает.
	decodeProblem(t, e.me(cookie1), http.StatusUnauthorized, "unauthorized")
	decodeProblem(t, e.me(cookie2), http.StatusUnauthorized, "unauthorized")
	if !e.emailVerified(t, cookie3) {
		t.Fatal("e-mail не подтверждён сбросом пароля")
	}
	if n := queryInt(t, e.pool, `SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1`, email); n != 1 {
		t.Fatalf("сессий: %d", n)
	}

	// Старый пароль не подходит, новый — подходит.
	decodeProblem(t, e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, testPassword)),
		http.StatusUnauthorized, "invalid_credentials")
	if rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, newPassword)); rec.Code != http.StatusOK {
		t.Fatalf("вход с новым паролем: %d %s", rec.Code, rec.Body)
	}

	// Токен одноразовый.
	expectInvalidToken(t, e.confirmReset(token, "another password"))
}

func TestPasswordResetTokenExpires(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	e.register(t, email)
	e.requestReset(email)
	_, token := e.lastLink(t, email)

	e.clock.Advance(resetPasswordTokenTTL)
	expectInvalidToken(t, e.confirmReset(token, "new password 123"))
}

func TestPasswordResetConfirmValidation(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	e.register(t, email)
	e.requestReset(email)
	_, token := e.lastLink(t, email)

	// Правила пароля — как при регистрации (проверяет контракт).
	body := decodeProblem(t, e.confirmReset(token, "short"), http.StatusUnprocessableEntity, "validation_failed")
	if got := fieldErrors(t, body); len(got) != 1 || got[0] != "password:too_short" {
		t.Fatalf("%v", got)
	}
	body = decodeProblem(t, e.confirmReset(token, strings.Repeat("x", 129)), http.StatusUnprocessableEntity, "validation_failed")
	if got := fieldErrors(t, body); len(got) != 1 || got[0] != "password:too_long" {
		t.Fatalf("%v", got)
	}
	// Отклонённые запросы токен не расходуют.
	if rec := e.confirmReset(token, "valid password"); rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

// Два одновременных запроса с одним токеном: успешен ровно один.
func TestEmailTokenCannotBeUsedTwiceConcurrently(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	e.register(t, email)
	e.requestReset(email)
	_, token := e.lastLink(t, email)

	const n = 5
	codes := make([]int, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Go(func() {
			codes[i] = e.confirmReset(token, "parallel password "+strconv.Itoa(i)).Code
		})
	}
	wg.Wait()
	ok := 0
	for _, c := range codes {
		switch c {
		case http.StatusOK:
			ok++
		case http.StatusUnprocessableEntity:
		default:
			t.Fatalf("статус %d", c)
		}
	}
	if ok != 1 {
		t.Fatalf("успешных сбросов: %d (%v)", ok, codes)
	}
	// Осталась ровно одна сессия — того, кто успел первым.
	if n := queryInt(t, e.pool, `SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1`, email); n != 1 {
		t.Fatalf("сессий: %d", n)
	}
}

func TestPasswordResetPerEmailLimit(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	e.register(t, email)
	missing := uniqueEmail()

	// Превышение лимита на адрес ответ не меняет — письмо просто не уходит.
	for range 5 {
		if rec := e.requestReset(email); rec.Code != http.StatusAccepted || rec.Body.Len() != 0 {
			t.Fatalf("%d %s", rec.Code, rec.Body)
		}
		if rec := e.requestReset(missing); rec.Code != http.StatusAccepted {
			t.Fatalf("несуществующий: %d", rec.Code)
		}
	}
	// 1 письмо подтверждения + 3 письма сброса.
	if n := len(e.mailsTo(t, email)); n != 4 {
		t.Fatalf("писем: %d", n)
	}

	e.clock.Advance(time.Hour)
	e.requestReset(email)
	if n := len(e.mailsTo(t, email)); n != 5 {
		t.Fatalf("писем после окна: %d", n)
	}
}

func TestPasswordResetPerIPLimit(t *testing.T) {
	e := newAuthEnv(t, Options{Limits: Limits{PasswordResetPerIP: ratelimit.Rule{Limit: 2, Window: time.Hour}}})
	const ip = "198.51.100.5:1000"
	e.requestReset(uniqueEmail(), withRemote(ip))
	// Невалидный запрос тоже расходует лимит.
	e.send(http.MethodPost, "/api/v1/auth/password-reset", `{"email":"not-an-email"}`, withRemote(ip))

	rec := e.requestReset(uniqueEmail(), withRemote(ip))
	decodeProblem(t, rec, http.StatusTooManyRequests, "too_many_requests")
	if rec.Header().Get("Retry-After") != "3600" {
		t.Fatalf("Retry-After = %q", rec.Header().Get("Retry-After"))
	}
	if rec := e.requestReset(uniqueEmail(), withRemote("198.51.100.6:1000")); rec.Code != http.StatusAccepted {
		t.Fatalf("другой IP: %d", rec.Code)
	}
	// Лимит отдельный от входа.
	if rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(uniqueEmail(), "x"), withRemote(ip)); rec.Code != http.StatusUnauthorized {
		t.Fatalf("вход: %d", rec.Code)
	}
}

func TestEmailTokenPerIPLimit(t *testing.T) {
	e := newAuthEnv(t, Options{Limits: Limits{EmailTokenPerIP: ratelimit.Rule{Limit: 2, Window: time.Minute}}})
	const ip = "198.51.100.7:1000"

	// Общий лимит для подтверждения e-mail и нового пароля.
	expectInvalidToken(t, e.send(http.MethodPost, "/api/v1/auth/verify-email", tokenBody("a"), withRemote(ip)))
	expectInvalidToken(t, e.confirmReset("b", "new password 123", withRemote(ip)))
	decodeProblem(t, e.send(http.MethodPost, "/api/v1/auth/verify-email", tokenBody("c"), withRemote(ip)),
		http.StatusTooManyRequests, "too_many_requests")
	decodeProblem(t, e.confirmReset("d", "new password 123", withRemote(ip)),
		http.StatusTooManyRequests, "too_many_requests")

	e.clock.Advance(time.Minute)
	expectInvalidToken(t, e.send(http.MethodPost, "/api/v1/auth/verify-email", tokenBody("e"), withRemote(ip)))
}

// Сброс пароля снимает блокировку входа по неудачным попыткам: владелец
// доказал доступ к почте.
func TestPasswordResetClearsLoginLimits(t *testing.T) {
	e := newAuthEnv(t, Options{Limits: Limits{LoginFailuresPerEmail: ratelimit.Rule{Limit: 2, Window: time.Hour}}})
	email := uniqueEmail()
	e.register(t, email)
	for i := range 2 {
		e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, "wrong password"), withRemote("198.51.100."+strconv.Itoa(i)+":1"))
	}
	decodeProblem(t, e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, testPassword)),
		http.StatusTooManyRequests, "too_many_requests")

	e.requestReset(email)
	_, token := e.lastLink(t, email)
	if rec := e.confirmReset(token, "brand new password"); rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, "brand new password"), withRemote("203.0.113.50:1")); rec.Code != http.StatusOK {
		t.Fatalf("вход после сброса: %d %s", rec.Code, rec.Body)
	}
}

// Адреса, которые проходят грубую проверку, но net/mail разбирает иначе
// (письмо на них не ушло бы), отклоняются при регистрации ошибкой формата.
func TestRegisterRejectsUnmailableEmail(t *testing.T) {
	e := newAuthEnv(t, Options{})
	for _, email := range []string{
		`a,b@example.com`,
		`a"b@example.com`,
		`<a@example.com>`,
		`Иван <a@example.com>`,
		`a(comment)@example.com`,
		`a..b@example.com`,
	} {
		t.Run(email, func(t *testing.T) {
			rec := e.send(http.MethodPost, "/api/v1/auth/register", registerBody(email, testPassword))
			body := decodeProblem(t, rec, http.StatusUnprocessableEntity, "validation_failed")
			if got := fieldErrors(t, body); len(got) != 1 || got[0] != "email:invalid_format" {
				t.Fatalf("%v", got)
			}
		})
	}
	// Обычные адреса, в т. ч. с «+» и пробелами по краям, по-прежнему принимаются.
	for _, email := range []string{"ivan+test-" + uniqueEmail(), "  " + uniqueEmail() + " "} {
		if rec := e.send(http.MethodPost, "/api/v1/auth/register", registerBody(email, testPassword)); rec.Code != http.StatusCreated {
			t.Fatalf("%q: %d %s", email, rec.Code, rec.Body)
		}
	}
}

// Одновременные запросы письма не оставляют двух действующих токенов:
// «погасить старые + создать новый» выполняются по очереди (блокировка
// строки пользователя).
func TestConcurrentTokenIssueLeavesOneToken(t *testing.T) {
	e := newAuthEnv(t, Options{Limits: Limits{PasswordResetPerEmail: ratelimit.Rule{Limit: 100, Window: time.Hour}}})
	email := uniqueEmail()
	e.register(t, email)

	var wg sync.WaitGroup
	for range 5 {
		wg.Go(func() { e.requestReset(email) })
	}
	wg.Wait()
	if n := len(e.mailsTo(t, email)); n != 6 {
		t.Fatalf("писем: %d", n)
	}
	if n := queryInt(t, e.pool, `
		SELECT count(*) FROM email_tokens t JOIN users u ON u.id = t.user_id
		WHERE u.email = $1 AND t.purpose = 'reset_password'`, email); n != 1 {
		t.Fatalf("токенов сброса: %d", n)
	}
}
