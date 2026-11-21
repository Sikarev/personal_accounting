package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/auth"
	"personal-accounting/api/internal/mail"
	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/ratelimit"
	"personal-accounting/api/internal/testdb"
)

// testClock — подменяемые часы: тест двигает время вперёд, не дожидаясь его.
type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *testClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// authEnv — роутер с подменёнными часами, пул тестовой БД и почтовый ящик
// in-memory (письма читаются через e.mails, см. email_test.go).
type authEnv struct {
	h       http.Handler
	pool    *pgxpool.Pool
	clock   *testClock
	mailbox *mail.Memory
	mail    *mail.Background
}

// newAuthEnv создаёт роутер. Лимит по IP по умолчанию поднят, чтобы тесты,
// которые его не проверяют, в него не упирались.
func newAuthEnv(t *testing.T, opts Options) authEnv {
	t.Helper()
	clock := &testClock{t: time.Now().UTC().Truncate(time.Microsecond)}
	opts.Now = clock.Now
	if opts.Limits.AuthPerIP.Limit == 0 {
		opts.Limits.AuthPerIP = ratelimit.Rule{Limit: 1000, Window: time.Minute}
	}
	mailbox := &mail.Memory{}
	opts.Mail = mail.NewBackground(mailbox, discardLogger, 5*time.Second)
	pool := testdb.Pool(t)
	h, err := NewRouter(discardLogger, pool, opts)
	if err != nil {
		t.Fatal(err)
	}
	return authEnv{h: h, pool: pool, clock: clock, mailbox: mailbox, mail: opts.Mail}
}

type reqOption func(*http.Request)

func withCookie(c *http.Cookie) reqOption {
	return func(r *http.Request) { r.AddCookie(c) }
}

func withHeader(k, v string) reqOption {
	return func(r *http.Request) { r.Header.Set(k, v) }
}

func withRemote(addr string) reqOption {
	return func(r *http.Request) { r.RemoteAddr = addr }
}

func (e authEnv) send(method, path, body string, opts ...reqOption) *httptest.ResponseRecorder {
	var req *http.Request
	if body != "" {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	} else {
		req = httptest.NewRequest(method, path, nil)
	}
	for _, o := range opts {
		o(req)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

// uniqueEmail — свой адрес на каждый тест: БД пакета общая для всех тестов.
func uniqueEmail() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return "user-" + hex.EncodeToString(b) + "@example.com"
}

func registerBody(email, password string) string {
	return `{"email":` + strconv.Quote(email) + `,"password":` + strconv.Quote(password) +
		`,"name":"Иван","timezone":"Europe/Moscow","acceptTerms":true}`
}

func loginBody(email, password string) string {
	return `{"email":` + strconv.Quote(email) + `,"password":` + strconv.Quote(password) + `}`
}

const testPassword = "correct horse battery"

// register регистрирует пользователя и возвращает cookie сессии и тело ответа.
func (e authEnv) register(t *testing.T, email string) (*http.Cookie, map[string]any) {
	t.Helper()
	rec := e.send(http.MethodPost, "/api/v1/auth/register", registerBody(email, testPassword))
	if rec.Code != http.StatusCreated {
		t.Fatalf("регистрация: %d %s", rec.Code, rec.Body)
	}
	return mustSessionCookie(t, rec), decodeJSON(t, rec)
}

func (e authEnv) me(cookie *http.Cookie) *httptest.ResponseRecorder {
	if cookie == nil {
		return e.send(http.MethodGet, "/api/v1/me", "")
	}
	return e.send(http.MethodGet, "/api/v1/me", "", withCookie(cookie))
}

func sessionCookie(rec *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookieName {
			return c
		}
	}
	return nil
}

func mustSessionCookie(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	c := sessionCookie(rec)
	if c == nil || c.Value == "" {
		t.Fatalf("нет cookie сессии; Set-Cookie: %q", rec.Header().Values("Set-Cookie"))
	}
	return c
}

func decodeJSON(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("тело не JSON: %v; %s", err, rec.Body)
	}
	return m
}

// fieldErrors — пары «поле:код» из errors[] ответа validation_failed.
func fieldErrors(t *testing.T, body map[string]any) []string {
	t.Helper()
	errs, _ := body["errors"].([]any)
	var out []string
	for _, e := range errs {
		fe := e.(map[string]any)
		out = append(out, fe["field"].(string)+":"+fe["code"].(string))
	}
	return out
}

func queryInt(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	return n
}

func TestRegisterCreatesUserFamilyAndCategories(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	rec := e.send(http.MethodPost, "/api/v1/auth/register", registerBody(email, testPassword),
		withHeader("User-Agent", "TestBrowser/1.0"), withRemote("203.0.113.7:5555"))
	if rec.Code != http.StatusCreated {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	body := decodeJSON(t, rec)

	user := body["user"].(map[string]any)
	family := body["family"].(map[string]any)
	userID, familyID := user["id"].(string), family["id"].(string)
	// Сырой JSON: проверяем и имена полей, и отсутствие лишних.
	wantUser := map[string]any{"id": userID, "email": email, "name": "Иван", "timezone": "Europe/Moscow", "emailVerified": false}
	wantFamily := map[string]any{"id": familyID, "name": "Семья", "role": "owner"}
	if !reflect.DeepEqual(user, wantUser) || !reflect.DeepEqual(family, wantFamily) || len(body) != 2 {
		t.Fatalf("ответ: %s", rec.Body)
	}

	ctx := context.Background()
	var (
		termsAt  *time.Time
		termsVer *string
		verified *time.Time
		hash     string
	)
	if err := e.pool.QueryRow(ctx,
		`SELECT terms_accepted_at, terms_version, email_verified_at, password_hash FROM users WHERE id = $1`, userID,
	).Scan(&termsAt, &termsVer, &verified, &hash); err != nil {
		t.Fatal(err)
	}
	if termsAt == nil || !termsAt.Equal(e.clock.Now()) || termsVer == nil || *termsVer != termsVersion {
		t.Fatalf("отметка о согласии: %v %v", termsAt, termsVer)
	}
	if verified != nil {
		t.Fatal("email_verified_at должен быть NULL")
	}
	if !strings.HasPrefix(hash, "$argon2id$") || strings.Contains(hash, testPassword) {
		t.Fatalf("пароль хранится не как argon2id: %s", hash)
	}

	if n := queryInt(t, e.pool, `SELECT count(*) FROM family_members WHERE user_id = $1 AND family_id = $2 AND role = 'owner'`, userID, familyID); n != 1 {
		t.Fatalf("нет членства owner: %d", n)
	}

	// Категории: 17 расходов верхнего уровня + 12 подкатегорий, 5 доходов.
	for _, c := range []struct {
		sql  string
		want int
	}{
		{`SELECT count(*) FROM categories WHERE family_id = $1 AND kind = 'expense' AND parent_id IS NULL`, 17},
		{`SELECT count(*) FROM categories WHERE family_id = $1 AND kind = 'expense' AND parent_id IS NOT NULL`, 12},
		{`SELECT count(*) FROM categories WHERE family_id = $1 AND kind = 'income' AND parent_id IS NULL`, 5},
		{`SELECT count(*) FROM categories WHERE family_id = $1 AND kind = 'income' AND parent_id IS NOT NULL`, 0},
	} {
		if n := queryInt(t, e.pool, c.sql, familyID); n != c.want {
			t.Errorf("%s: %d, ожидалось %d", c.sql, n, c.want)
		}
	}
	// Подкатегория привязана к своему родителю, порядок — по списку.
	var parent string
	var order int
	if err := e.pool.QueryRow(ctx, `
		SELECT p.name, c.sort_order FROM categories c JOIN categories p ON p.id = c.parent_id
		WHERE c.family_id = $1 AND c.name = 'Такси'`, familyID).Scan(&parent, &order); err != nil {
		t.Fatal(err)
	}
	if parent != "Транспорт" || order != 2 {
		t.Fatalf("Такси: родитель %q, порядок %d", parent, order)
	}
	if n := queryInt(t, e.pool, `SELECT sort_order FROM categories WHERE family_id = $1 AND name = 'Прочие расходы'`, familyID); n != 17 {
		t.Fatalf("sort_order «Прочие расходы» = %d", n)
	}

	// Сессия: в БД хеш токена, IP и User-Agent.
	cookie := mustSessionCookie(t, rec)
	var ip netip.Addr
	var ua string
	if err := e.pool.QueryRow(ctx, `SELECT ip, user_agent FROM sessions WHERE token_hash = $1 AND user_id = $2`,
		auth.HashToken(cookie.Value), userID).Scan(&ip, &ua); err != nil {
		t.Fatalf("сессия не найдена по хешу токена: %v", err)
	}
	if ip.String() != "203.0.113.7" || ua != "TestBrowser/1.0" {
		t.Fatalf("сессия: ip %v, user_agent %q", ip, ua)
	}
	if n := queryInt(t, e.pool, `SELECT count(*) FROM sessions WHERE token_hash = $1`, []byte(cookie.Value)); n != 0 {
		t.Fatal("токен хранится в БД в открытом виде")
	}
}

// Регистрация — одна транзакция: сбой на последнем шаге (создание сессии)
// откатывает и пользователя, и семью, и категории.
func TestRegisterIsAtomic(t *testing.T) {
	e := newAuthEnv(t, Options{})
	ctx := context.Background()
	// Триггер роняет вставку сессии с особым User-Agent — так ошибка возникает
	// внутри транзакции регистрации без моков.
	if _, err := e.pool.Exec(ctx, `
		CREATE FUNCTION fail_session() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN
			IF NEW.user_agent = 'fail-registration' THEN RAISE EXCEPTION 'сбой для теста'; END IF;
			RETURN NEW;
		END $$;
		CREATE TRIGGER fail_session BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION fail_session();`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = e.pool.Exec(ctx, `DROP TRIGGER fail_session ON sessions; DROP FUNCTION fail_session();`)
	})

	families := queryInt(t, e.pool, `SELECT count(*) FROM families`)
	categories := queryInt(t, e.pool, `SELECT count(*) FROM categories`)

	email := uniqueEmail()
	rec := e.send(http.MethodPost, "/api/v1/auth/register", registerBody(email, testPassword),
		withHeader("User-Agent", "fail-registration"))
	decodeProblem(t, rec, http.StatusInternalServerError, "internal")
	if sessionCookie(rec) != nil {
		t.Fatal("при сбое выдана cookie")
	}

	if n := queryInt(t, e.pool, `SELECT count(*) FROM users WHERE email = $1`, email); n != 0 {
		t.Fatal("пользователь остался после отката")
	}
	if queryInt(t, e.pool, `SELECT count(*) FROM families`) != families ||
		queryInt(t, e.pool, `SELECT count(*) FROM categories`) != categories {
		t.Fatal("семья или категории остались после отката")
	}

	// Тот же e-mail после сбоя регистрируется нормально.
	e.register(t, email)
}

func TestRegisterAndLoginEmailIsCaseInsensitive(t *testing.T) {
	e := newAuthEnv(t, Options{})
	local := strings.TrimSuffix(uniqueEmail(), "@example.com")

	rec := e.send(http.MethodPost, "/api/v1/auth/register", registerBody("  "+strings.ToUpper(local)+"@Example.COM ", testPassword))
	if rec.Code != http.StatusCreated {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	email := local + "@example.com"
	if got := decodeJSON(t, rec)["user"].(map[string]any)["email"]; got != email {
		t.Fatalf("e-mail не нормализован: %v", got)
	}

	rec = e.send(http.MethodPost, "/api/v1/auth/login", loginBody(local+"@EXAMPLE.com", testPassword))
	if rec.Code != http.StatusOK {
		t.Fatalf("вход с e-mail в другом регистре: %d %s", rec.Code, rec.Body)
	}
	cookie := mustSessionCookie(t, rec)
	if decodeJSON(t, rec)["user"].(map[string]any)["email"] != email {
		t.Fatalf("тело входа: %s", rec.Body)
	}
	if rec := e.me(cookie); rec.Code != http.StatusOK {
		t.Fatalf("/me после входа: %d %s", rec.Code, rec.Body)
	}
}

// Неверный пароль и несуществующий e-mail неотличимы по ответу.
func TestLoginFailuresLookTheSame(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	e.register(t, email)

	wrongPassword := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, "wrong password"))
	unknownEmail := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(uniqueEmail(), "wrong password"))

	decodeProblem(t, wrongPassword, http.StatusUnauthorized, "invalid_credentials")
	decodeProblem(t, unknownEmail, http.StatusUnauthorized, "invalid_credentials")
	if wrongPassword.Body.String() != unknownEmail.Body.String() {
		t.Fatalf("тела различаются:\n%s\n%s", wrongPassword.Body, unknownEmail.Body)
	}
	if sessionCookie(wrongPassword) != nil || sessionCookie(unknownEmail) != nil {
		t.Fatal("при неудачном входе выдана cookie")
	}
}

func TestRegisterEmailTaken(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	e.register(t, email)

	rec := e.send(http.MethodPost, "/api/v1/auth/register", registerBody(strings.ToUpper(email), testPassword))
	body := decodeProblem(t, rec, http.StatusUnprocessableEntity, "validation_failed")
	if got := fieldErrors(t, body); !reflect.DeepEqual(got, []string{"email:email_taken"}) {
		t.Fatalf("errors = %v", got)
	}
}

func TestRegisterValidation(t *testing.T) {
	e := newAuthEnv(t, Options{})
	for _, c := range []struct {
		name, body string
		want       []string
	}{
		{"без acceptTerms", `{"email":"a@example.com","password":"12345678","name":"Иван","timezone":"Europe/Moscow"}`, []string{"acceptTerms:required"}},
		{"acceptTerms false", `{"email":"a@example.com","password":"12345678","name":"Иван","timezone":"Europe/Moscow","acceptTerms":false}`, []string{"acceptTerms:invalid_value"}},
		{"неизвестный пояс", `{"email":"a@example.com","password":"12345678","name":"Иван","timezone":"Mars/Olympus","acceptTerms":true}`, []string{"timezone:invalid_value"}},
		{"пояс Local", `{"email":"a@example.com","password":"12345678","name":"Иван","timezone":"Local","acceptTerms":true}`, []string{"timezone:invalid_value"}},
		{"имя из пробелов", `{"email":"a@example.com","password":"12345678","name":"   ","timezone":"Europe/Moscow","acceptTerms":true}`, []string{"name:required"}},
		{"короткий пароль", `{"email":"a@example.com","password":"1234567","name":"Иван","timezone":"Europe/Moscow","acceptTerms":true}`, []string{"password:too_short"}},
		{"не e-mail", `{"email":"not-an-email","password":"12345678","name":"Иван","timezone":"Europe/Moscow","acceptTerms":true}`, []string{"email:invalid_format"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := e.send(http.MethodPost, "/api/v1/auth/register", c.body)
			body := decodeProblem(t, rec, http.StatusUnprocessableEntity, "validation_failed")
			if got := fieldErrors(t, body); !reflect.DeepEqual(got, c.want) {
				t.Fatalf("errors = %v, ожидалось %v", got, c.want)
			}
		})
	}
	if n := queryInt(t, e.pool, `SELECT count(*) FROM users WHERE email = 'a@example.com'`); n != 0 {
		t.Fatal("невалидная регистрация создала пользователя")
	}
}

func TestRegisterKeepsTimezone(t *testing.T) {
	e := newAuthEnv(t, Options{})
	body := strings.Replace(registerBody(uniqueEmail(), testPassword), "Europe/Moscow", "Asia/Vladivostok", 1)
	rec := e.send(http.MethodPost, "/api/v1/auth/register", body)
	if rec.Code != http.StatusCreated || decodeJSON(t, rec)["user"].(map[string]any)["timezone"] != "Asia/Vladivostok" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestSessionCookieFlags(t *testing.T) {
	for _, secure := range []bool{false, true} {
		t.Run("Secure="+strconv.FormatBool(secure), func(t *testing.T) {
			e := newAuthEnv(t, Options{CookieSecure: secure})
			c, _ := e.register(t, uniqueEmail())
			if !c.HttpOnly || c.SameSite != http.SameSiteLaxMode || c.Path != "/api" || c.Secure != secure {
				t.Fatalf("флаги cookie: %+v", c)
			}
			if c.MaxAge != int(sessionTTL/time.Second) {
				t.Fatalf("Max-Age = %d", c.MaxAge)
			}
			if len(c.Value) != 43 {
				t.Fatalf("токен не похож на 32 байта base64url: %q", c.Value)
			}
		})
	}
}

func TestMeRequiresValidSession(t *testing.T) {
	e := newAuthEnv(t, Options{})

	t.Run("без cookie", func(t *testing.T) {
		decodeProblem(t, e.me(nil), http.StatusUnauthorized, "unauthorized")
	})
	t.Run("неизвестный токен", func(t *testing.T) {
		rec := e.me(&http.Cookie{Name: sessionCookieName, Value: "bogus"})
		decodeProblem(t, rec, http.StatusUnauthorized, "unauthorized")
		if c := sessionCookie(rec); c == nil || c.MaxAge >= 0 {
			t.Fatal("мёртвая cookie не стёрта")
		}
	})
	t.Run("удалённая сессия", func(t *testing.T) {
		c, _ := e.register(t, uniqueEmail())
		if _, err := e.pool.Exec(context.Background(), `DELETE FROM sessions WHERE token_hash = $1`, auth.HashToken(c.Value)); err != nil {
			t.Fatal(err)
		}
		decodeProblem(t, e.me(c), http.StatusUnauthorized, "unauthorized")
	})
	t.Run("просроченная сессия", func(t *testing.T) {
		c, _ := e.register(t, uniqueEmail())
		if rec := e.me(c); rec.Code != http.StatusOK {
			t.Fatalf("%d %s", rec.Code, rec.Body)
		}
		e.clock.Advance(sessionTTL + time.Second)
		decodeProblem(t, e.me(c), http.StatusUnauthorized, "unauthorized")
		if n := queryInt(t, e.pool, `SELECT count(*) FROM sessions WHERE token_hash = $1`, auth.HashToken(c.Value)); n != 0 {
			t.Fatal("просроченная сессия не удалена")
		}
	})
}

// Срок сессии скользящий: активность продлевает её, но не чаще раза в час.
func TestSessionSlidingExpiry(t *testing.T) {
	e := newAuthEnv(t, Options{})
	c, _ := e.register(t, uniqueEmail())

	e.clock.Advance(30 * time.Minute)
	rec := e.me(c)
	if rec.Code != http.StatusOK || sessionCookie(rec) != nil {
		t.Fatalf("продление раньше чем через час: %d, Set-Cookie %q", rec.Code, rec.Header().Values("Set-Cookie"))
	}

	e.clock.Advance(time.Hour) // с создания прошло 1,5 часа
	rec = e.me(c)
	renewed := mustSessionCookie(t, rec)
	if renewed.Value != c.Value || renewed.MaxAge != int(sessionTTL/time.Second) {
		t.Fatalf("продлённая cookie: %+v", renewed)
	}
	var expires time.Time
	if err := e.pool.QueryRow(context.Background(), `SELECT expires_at FROM sessions WHERE token_hash = $1`,
		auth.HashToken(c.Value)).Scan(&expires); err != nil {
		t.Fatal(err)
	}
	if !expires.Equal(e.clock.Now().Add(sessionTTL)) {
		t.Fatalf("expires_at = %v, ожидалось %v", expires, e.clock.Now().Add(sessionTTL))
	}

	// Исходный срок прошёл, но сессия продлена — она действует.
	e.clock.Advance(sessionTTL - time.Hour)
	if rec := e.me(c); rec.Code != http.StatusOK {
		t.Fatalf("продлённая сессия не действует: %d", rec.Code)
	}
}

func TestLogout(t *testing.T) {
	e := newAuthEnv(t, Options{})
	c, _ := e.register(t, uniqueEmail())

	rec := e.send(http.MethodPost, "/api/v1/auth/logout", "", withCookie(c))
	if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if cleared := sessionCookie(rec); cleared == nil || cleared.MaxAge >= 0 || cleared.Value != "" || cleared.Path != "/api" {
		t.Fatalf("cookie не стёрта: %q", rec.Header().Values("Set-Cookie"))
	}
	if n := queryInt(t, e.pool, `SELECT count(*) FROM sessions WHERE token_hash = $1`, auth.HashToken(c.Value)); n != 0 {
		t.Fatal("сессия осталась в БД")
	}
	decodeProblem(t, e.me(c), http.StatusUnauthorized, "unauthorized")

	// Идемпотентность: повторный выход и выход без cookie — тоже 204.
	for _, opts := range [][]reqOption{{withCookie(c)}, nil} {
		if rec := e.send(http.MethodPost, "/api/v1/auth/logout", "", opts...); rec.Code != http.StatusNoContent {
			t.Fatalf("повторный выход: %d %s", rec.Code, rec.Body)
		}
	}
}

// Повторный вход в том же браузере закрывает прежнюю сессию.
func TestLoginReplacesPreviousSession(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	old, _ := e.register(t, email)

	rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, testPassword), withCookie(old))
	fresh := mustSessionCookie(t, rec)
	if fresh.Value == old.Value {
		t.Fatal("токен не сменился")
	}
	decodeProblem(t, e.me(old), http.StatusUnauthorized, "unauthorized")
	if rec := e.me(fresh); rec.Code != http.StatusOK {
		t.Fatalf("новая сессия: %d", rec.Code)
	}
}

// Каждый пользователь видит в /me свою семью.
func TestMeReturnsOwnFamily(t *testing.T) {
	e := newAuthEnv(t, Options{})
	emailA, emailB := uniqueEmail(), uniqueEmail()
	cookieA, regA := e.register(t, emailA)
	cookieB, regB := e.register(t, emailB)

	familyA := regA["family"].(map[string]any)["id"]
	familyB := regB["family"].(map[string]any)["id"]
	if familyA == familyB {
		t.Fatal("у разных пользователей одна семья")
	}
	for _, c := range []struct {
		cookie        *http.Cookie
		email, family any
	}{{cookieA, emailA, familyA}, {cookieB, emailB, familyB}} {
		body := decodeJSON(t, e.me(c.cookie))
		if body["user"].(map[string]any)["email"] != c.email || body["family"].(map[string]any)["id"] != c.family {
			t.Fatalf("/me для %s: %v", c.email, body)
		}
	}
}

// Публичность операций задаётся контрактом (security), а не кодом.
func TestContractSecurity(t *testing.T) {
	doc, err := oapi.GetSpec()
	if err != nil {
		t.Fatal(err)
	}
	public := map[string]bool{}
	for _, route := range newSpecRoutes(doc, apiPrefix) {
		public[operationID(route)] = isPublic(route)
	}
	want := map[string]bool{
		"listCurrencies": true, "register": true, "login": true, "logout": true, "getMe": false,
		// Ссылку из письма могут открыть в другом браузере, без сессии.
		"verifyEmail": true, "requestPasswordReset": true, "confirmPasswordReset": true,
		"resendVerificationEmail": false,
		// Счета — только со входом.
		"listAccounts": false, "createAccount": false, "updateAccount": false, "deleteAccount": false,
		"archiveAccount": false, "unarchiveAccount": false, "reorderAccounts": false,
		"adjustAccountBalance": false,
	}
	if !reflect.DeepEqual(public, want) {
		t.Fatalf("публичные операции: %v, ожидалось %v", public, want)
	}

	// listCurrencies доступен без входа.
	e := newAuthEnv(t, Options{})
	if rec := e.send(http.MethodGet, "/api/v1/currencies", ""); rec.Code != http.StatusOK {
		t.Fatalf("справочник без входа: %d %s", rec.Code, rec.Body)
	}
}

func TestAuthRateLimitByIP(t *testing.T) {
	e := newAuthEnv(t, Options{Limits: Limits{AuthPerIP: ratelimit.Rule{Limit: 3, Window: time.Minute}}})
	const ip = "198.51.100.1:1000"

	// Лимит общий для входа и регистрации и считает и невалидные запросы.
	e.send(http.MethodPost, "/api/v1/auth/login", loginBody(uniqueEmail(), "x"), withRemote(ip))
	e.send(http.MethodPost, "/api/v1/auth/register", `{}`, withRemote(ip))
	e.send(http.MethodPost, "/api/v1/auth/login", loginBody(uniqueEmail(), "x"), withRemote(ip))

	rec := e.send(http.MethodPost, "/api/v1/auth/register", registerBody(uniqueEmail(), testPassword), withRemote(ip))
	decodeProblem(t, rec, http.StatusTooManyRequests, "too_many_requests")
	if ra := rec.Header().Get("Retry-After"); ra != "60" {
		t.Fatalf("Retry-After = %q, ожидалось 60", ra)
	}

	// Другой адрес считается отдельно; прочие операции лимит не трогает.
	if rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(uniqueEmail(), "x"), withRemote("198.51.100.2:1000")); rec.Code != http.StatusUnauthorized {
		t.Fatalf("другой IP: %d", rec.Code)
	}
	if rec := e.send(http.MethodGet, "/api/v1/currencies", "", withRemote(ip)); rec.Code != http.StatusOK {
		t.Fatalf("справочник под лимитом: %d", rec.Code)
	}

	e.clock.Advance(time.Minute)
	if rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(uniqueEmail(), "x"), withRemote(ip)); rec.Code != http.StatusUnauthorized {
		t.Fatalf("после окна: %d %s", rec.Code, rec.Body)
	}
}

func TestLoginRateLimitByEmailAndIP(t *testing.T) {
	e := newAuthEnv(t, Options{})
	email := uniqueEmail()
	e.register(t, email)
	const attacker, owner = "198.51.100.66:1000", "203.0.113.10:1000"

	// Успешный вход сбрасывает счёт: 4 ошибки + успех + 4 ошибки — без 429.
	for range 4 {
		e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, "wrong password"), withRemote(attacker))
	}
	if rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, testPassword), withRemote(attacker)); rec.Code != http.StatusOK {
		t.Fatalf("вход: %d %s", rec.Code, rec.Body)
	}

	// 5 неудачных попыток с одного адреса — дальше с него 429 даже с верным паролем.
	for range 5 {
		rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, "wrong password"), withRemote(attacker))
		decodeProblem(t, rec, http.StatusUnauthorized, "invalid_credentials")
	}
	e.clock.Advance(time.Minute)
	rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(strings.ToUpper(email), testPassword), withRemote(attacker))
	decodeProblem(t, rec, http.StatusTooManyRequests, "too_many_requests")
	if ra := rec.Header().Get("Retry-After"); ra != strconv.Itoa(int((14 * time.Minute).Seconds())) {
		t.Fatalf("Retry-After = %q", ra)
	}

	// Владелец с другого адреса входит: блокировка с чужого IP ему не мешает.
	if rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, testPassword), withRemote(owner)); rec.Code != http.StatusOK {
		t.Fatalf("вход с другого IP: %d %s", rec.Code, rec.Body)
	}
	// IPv6 из той же /64 — тот же ключ.
	for range 5 {
		e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, "wrong password"), withRemote("[2001:db8:1:2::1]:1000"))
	}
	rec = e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, testPassword), withRemote("[2001:db8:1:2::ffff]:1000"))
	decodeProblem(t, rec, http.StatusTooManyRequests, "too_many_requests")

	e.clock.Advance(14 * time.Minute)
	if rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, testPassword), withRemote(attacker)); rec.Code != http.StatusOK {
		t.Fatalf("после окна: %d %s", rec.Code, rec.Body)
	}
}

// Общий лимит неудач на e-mail срабатывает при переборе с многих адресов
// и не сбрасывается успешным входом.
func TestLoginFailuresPerEmailAcrossIPs(t *testing.T) {
	e := newAuthEnv(t, Options{Limits: Limits{LoginFailuresPerEmail: ratelimit.Rule{Limit: 6, Window: time.Hour}}})
	email := uniqueEmail()
	e.register(t, email)
	from := func(i int) reqOption { return withRemote("198.51.100." + strconv.Itoa(i) + ":1000") }

	for i := range 3 {
		e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, "wrong password"), from(i))
	}
	if rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, testPassword), from(100)); rec.Code != http.StatusOK {
		t.Fatalf("вход до лимита: %d", rec.Code)
	}
	for i := 3; i < 6; i++ {
		decodeProblem(t, e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, "wrong password"), from(i)),
			http.StatusUnauthorized, "invalid_credentials")
	}
	// 6 неудач с 6 адресов (успех между ними счёт не сбросил) — блокируется любой адрес.
	rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, testPassword), from(200))
	decodeProblem(t, rec, http.StatusTooManyRequests, "too_many_requests")
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("нет Retry-After")
	}
	// Другие аккаунты не затронуты.
	if rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(uniqueEmail(), "x"), from(200)); rec.Code != http.StatusUnauthorized {
		t.Fatalf("другой e-mail: %d", rec.Code)
	}

	e.clock.Advance(time.Hour)
	if rec := e.send(http.MethodPost, "/api/v1/auth/login", loginBody(email, testPassword), from(200)); rec.Code != http.StatusOK {
		t.Fatalf("после окна: %d %s", rec.Code, rec.Body)
	}
}

// Управляющие символы (NUL и др.) в имени и e-mail — 422 по полю, а не 500
// от Postgres; при входе они не расходуют лимиты по e-mail.
func TestControlCharsRejected(t *testing.T) {
	e := newAuthEnv(t, Options{Limits: Limits{LoginPerEmailIP: ratelimit.Rule{Limit: 1, Window: time.Hour}}})
	for _, c := range []struct {
		name, path, body, want string
	}{
		{"имя с NUL", "/api/v1/auth/register",
			`{"email":"` + uniqueEmail() + `","password":"12345678","name":"a\u0000b","timezone":"Europe/Moscow","acceptTerms":true}`, "name:invalid_format"},
		{"имя с переводом строки", "/api/v1/auth/register",
			`{"email":"` + uniqueEmail() + `","password":"12345678","name":"Иван\nПетров","timezone":"Europe/Moscow","acceptTerms":true}`, "name:invalid_format"},
		{"e-mail с NUL при регистрации", "/api/v1/auth/register",
			`{"email":"a\u0000b@example.com","password":"12345678","name":"Иван","timezone":"Europe/Moscow","acceptTerms":true}`, "email:invalid_format"},
		{"e-mail с NUL при входе", "/api/v1/auth/login", `{"email":"a\u0000b@example.com","password":"x"}`, "email:invalid_format"},
	} {
		t.Run(c.name, func(t *testing.T) {
			body := decodeProblem(t, e.send(http.MethodPost, c.path, c.body), http.StatusUnprocessableEntity, "validation_failed")
			if got := fieldErrors(t, body); !reflect.DeepEqual(got, []string{c.want}) {
				t.Fatalf("errors = %v", got)
			}
		})
	}
	// Отклонённые входы не потратили лимит (он здесь — 1 попытка): обычная
	// попытка для того же e-mail проходит до проверки пароля.
	decodeProblem(t, e.send(http.MethodPost, "/api/v1/auth/login", loginBody("ab@example.com", "x")),
		http.StatusUnauthorized, "invalid_credentials")
}

func TestCSRF(t *testing.T) {
	e := newAuthEnv(t, Options{CSRFTrustedOrigins: []string{"https://trusted.example"}})
	login := loginBody(uniqueEmail(), "x")

	for _, c := range []struct {
		name string
		opts []reqOption
		want int
	}{
		// Браузер сообщает, что запрос со страницы другого сайта.
		{"Sec-Fetch-Site: cross-site", []reqOption{withHeader("Sec-Fetch-Site", "cross-site")}, http.StatusForbidden},
		// Старый браузер без Sec-Fetch-Site: Origin не совпадает с Host.
		{"чужой Origin", []reqOption{withHeader("Origin", "https://evil.example")}, http.StatusForbidden},
		// Обычный запрос со своей страницы (в т. ч. через прокси Vite: браузер
		// видит один origin localhost:5173 и шлёт same-origin).
		{"Sec-Fetch-Site: same-origin", []reqOption{withHeader("Sec-Fetch-Site", "same-origin"), withHeader("Origin", "http://localhost:5173")}, http.StatusUnauthorized},
		// Телефон по http://192.168.x.x:5173 — Sec-Fetch-Site там не шлётся,
		// а прокси Vite сохраняет Host, и Origin с ним совпадает.
		{"Origin совпадает с Host", []reqOption{withHeader("Origin", "http://example.com")}, http.StatusUnauthorized},
		{"доверенный origin", []reqOption{withHeader("Sec-Fetch-Site", "cross-site"), withHeader("Origin", "https://trusted.example")}, http.StatusUnauthorized},
		// Не браузер (curl, тесты): заголовков нет — пропускаем.
		{"без заголовков", nil, http.StatusUnauthorized},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := e.send(http.MethodPost, "/api/v1/auth/login", login, c.opts...)
			if c.want == http.StatusForbidden {
				decodeProblem(t, rec, http.StatusForbidden, "forbidden_origin")
				return
			}
			if rec.Code != c.want {
				t.Fatalf("%d %s", rec.Code, rec.Body)
			}
		})
	}

	// Безопасные методы (GET) кросс-доменная защита не трогает.
	if rec := e.send(http.MethodGet, "/api/v1/currencies", "", withHeader("Sec-Fetch-Site", "cross-site")); rec.Code != http.StatusOK {
		t.Fatalf("GET cross-site: %d", rec.Code)
	}
}

func TestClientIP(t *testing.T) {
	trusted := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("fd00::/8")}
	for _, c := range []struct {
		name, remote string
		xff          []string
		trusted      []netip.Prefix
		want         string
	}{
		{"без прокси", "203.0.113.5:443", nil, nil, "203.0.113.5"},
		{"XFF от недоверенного игнорируется", "203.0.113.5:443", []string{"1.2.3.4"}, trusted, "203.0.113.5"},
		{"XFF без списка прокси игнорируется", "10.0.0.1:443", []string{"1.2.3.4"}, nil, "10.0.0.1"},
		{"один прокси", "10.0.0.1:443", []string{"198.51.100.9"}, trusted, "198.51.100.9"},
		{"подделка слева отбрасывается", "10.0.0.1:443", []string{"6.6.6.6, 198.51.100.9"}, trusted, "198.51.100.9"},
		{"цепочка прокси", "10.0.0.1:443", []string{"198.51.100.9, 10.0.0.3", "10.0.0.2"}, trusted, "198.51.100.9"},
		{"все адреса доверенные", "10.0.0.1:443", []string{"10.0.0.3, 10.0.0.2"}, trusted, "10.0.0.3"},
		{"мусор в XFF", "10.0.0.1:443", []string{"garbage, 10.0.0.2"}, trusted, "10.0.0.2"},
		{"доверенный прокси без XFF", "10.0.0.1:443", nil, trusted, "10.0.0.1"},
		{"IPv6 и порт в XFF", "[fd00::1]:443", []string{"[2001:db8::7]:5000"}, trusted, "2001:db8::7"},
		{"IPv4 в форме IPv6", "[::ffff:203.0.113.5]:443", nil, nil, "203.0.113.5"},
		{"адрес не разобрать", "pipe", nil, nil, "invalid IP"},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := clientIP(c.remote, c.xff, c.trusted).String(); got != c.want {
				t.Fatalf("clientIP = %s, ожидалось %s", got, c.want)
			}
		})
	}
}

// Реальный IP через доверенный прокси попадает в сессию и в лог запросов.
func TestRealIPReachesSessionAndLog(t *testing.T) {
	logger, logBuf := jsonLogger()
	clock := &testClock{t: time.Now()}
	pool := testdb.Pool(t)
	h, err := NewRouter(logger, pool, Options{
		TrustedProxies: []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8")},
		Now:            clock.Now,
	})
	if err != nil {
		t.Fatal(err)
	}
	e := authEnv{h: h, pool: pool, clock: clock}

	rec := e.send(http.MethodPost, "/api/v1/auth/register", registerBody(uniqueEmail(), testPassword),
		withRemote("10.0.0.1:5000"), withHeader("X-Forwarded-For", "6.6.6.6, 203.0.113.50"))
	c := mustSessionCookie(t, rec)
	var ip netip.Addr
	if err := pool.QueryRow(context.Background(), `SELECT ip FROM sessions WHERE token_hash = $1`, auth.HashToken(c.Value)).Scan(&ip); err != nil {
		t.Fatal(err)
	}
	if ip.String() != "203.0.113.50" {
		t.Fatalf("sessions.ip = %s", ip)
	}
	if !strings.Contains(logBuf.String(), `"ip":"203.0.113.50"`) {
		t.Fatalf("IP клиента нет в логе:\n%s", logBuf)
	}
}

func TestRateLimitKeyGroupsIPv6By64(t *testing.T) {
	a := rateLimitKey(netip.MustParseAddr("2001:db8:1:2::1"))
	b := rateLimitKey(netip.MustParseAddr("2001:db8:1:2:ffff::9"))
	c := rateLimitKey(netip.MustParseAddr("2001:db8:1:3::1"))
	if a != b || a == c {
		t.Fatalf("ключи: %s %s %s", a, b, c)
	}
	if got := rateLimitKey(netip.MustParseAddr("203.0.113.5")); got != "203.0.113.5" {
		t.Fatalf("IPv4: %s", got)
	}
}

func TestSanitizeUserAgent(t *testing.T) {
	if got := sanitizeUserAgent("a\x00b\xffc"); got != "abc" {
		t.Fatalf("%q", got)
	}
	long := strings.Repeat("ж", 400) // 800 байт
	got := sanitizeUserAgent(long)
	if len(got) > maxUserAgentLen || !strings.HasPrefix(long, got) || len(got) != 512 {
		t.Fatalf("длина %d", len(got))
	}
}
