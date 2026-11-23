package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/netip"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"personal-accounting/api/internal/auth"
	"personal-accounting/api/internal/db/dbgen"
	"personal-accounting/api/internal/mail"
	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/problem"
)

const (
	// termsVersion — версия политики ПДн и пользовательского соглашения, с которой
	// соглашается пользователь при регистрации. Меняется вместе с текстами.
	// Сейчас тексты — заглушки.
	termsVersion = "stub-2026-11-19"
	// defaultFamilyName — имя семьи, которая создаётся при регистрации.
	defaultFamilyName = "Семья"

	// SQLSTATE нарушения уникальности и имя индекса e-mail из 00001_init.sql.
	uniqueViolation = "23505"
	usersEmailKey   = "users_email_key"
)

func (s *server) Register(ctx context.Context, req oapi.RegisterRequestObject) (oapi.RegisterResponseObject, error) {
	b := req.Body
	email := normalizeEmail(b.Email)
	name := strings.TrimSpace(b.Name)

	// Длины, формат e-mail и acceptTerms = true проверил валидатор контракта.
	// Здесь — то, что схемой не выразить.
	// Управляющие символы в e-mail отклоняет уже валидатор контракта (format: email).
	var errs []problem.FieldError
	switch {
	case name == "":
		errs = append(errs, problem.FieldError{Field: "name", Code: "required", Message: "Укажите имя."})
	case hasControlChars(name):
		errs = append(errs, problem.FieldError{Field: "name", Code: "invalid_format", Message: "Имя содержит недопустимые символы."})
	}
	if !validTimezone(b.Timezone) {
		errs = append(errs, problem.FieldError{Field: "timezone", Code: "invalid_value", Message: "Неизвестный часовой пояс."})
	}
	if len(errs) > 0 {
		return nil, problem.Validation(errs...)
	}

	// Хеш считаем до транзакции: он занимает десятки миллисекунд, а держать
	// транзакцию открытой без нужды не стоит.
	passwordHash := auth.HashPassword(b.Password)
	now := s.now()
	version := termsVersion

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	// Rollback после Commit ничего не делает: при любом раннем return
	// транзакция откатится — пользователь без семьи или категорий не появится.
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	userID, err := q.CreateUser(ctx, dbgen.CreateUserParams{
		Email:           email,
		Name:            name,
		PasswordHash:    &passwordHash,
		Timezone:        b.Timezone,
		TermsAcceptedAt: &now,
		TermsVersion:    &version,
	})
	if isUniqueViolation(err, usersEmailKey) {
		// Факт регистрации раскрывается осознанно ради понятной ошибки;
		// перебор адресов ограничивает лимит частоты по IP.
		return nil, problem.Validation(problem.FieldError{
			Field: "email", Code: "email_taken", Message: "Этот e-mail уже зарегистрирован.",
		})
	}
	if err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}

	familyID, err := q.CreateFamily(ctx, defaultFamilyName)
	if err != nil {
		return nil, fmt.Errorf("create family: %w", err)
	}
	if err := q.AddFamilyMember(ctx, dbgen.AddFamilyMemberParams{
		FamilyID: familyID, UserID: userID, Role: dbgen.FamilyRoleOwner,
	}); err != nil {
		return nil, fmt.Errorf("add family owner: %w", err)
	}
	if err := createDefaultCategories(ctx, q, familyID); err != nil {
		return nil, err
	}
	token, expires, err := s.createSession(ctx, q, userID, now)
	if err != nil {
		return nil, err
	}
	// Токен подтверждения — в той же транзакции, а письмо — только после
	// коммита: иначе при откате пришло бы письмо для несуществующего аккаунта.
	verifyToken, err := s.createEmailToken(ctx, q, userID, email, dbgen.EmailTokenPurposeVerifyEmail, now)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit registration: %w", err)
	}
	s.sendVerifyLetter(ctx, userID, mail.Letter{
		Name: name, Email: email, Link: s.emailLink(verifyEmailPath, verifyToken),
	})

	me, err := s.me(ctx, userID, familyID)
	if err != nil {
		return nil, err
	}
	cookie := s.sessionCookie(token, expires).String()
	return oapi.Register201JSONResponse{Body: me, Headers: oapi.Register201ResponseHeaders{SetCookie: &cookie}}, nil
}

func (s *server) Login(ctx context.Context, req oapi.LoginRequestObject) (oapi.LoginResponseObject, error) {
	email := normalizeEmail(req.Body.Email)

	// Два лимита (docs/api.md, «Ограничение частоты»). Несуществующие e-mail
	// считаются так же, как существующие, — по ответу не понять, есть ли аккаунт.
	//
	// 1. Неудачные попытки на e-mail со всех адресов — защита от распределённого
	//    перебора. Учитываются только неудачи, успешный вход счёт не сбрасывает.
	if retry, ok := s.loginFailures.Check(email); !ok {
		return nil, problem.TooManyRequests(retry)
	}
	// 2. Попытки на «e-mail + IP». Ключ включает IP, чтобы посторонний не мог
	//    заблокировать владельцу вход неверными паролями со своего адреса.
	//    Попытка учитывается до проверки пароля, а успешный вход сбрасывает счёт:
	//    так параллельные запросы не проскочат лимит, пока считается хеш.
	attemptKey := email + " " + rateLimitKey(clientInfoFrom(ctx).IP)
	if retry, ok := s.loginAttempts.Allow(attemptKey); !ok {
		return nil, problem.TooManyRequests(retry)
	}

	userID, ok, err := s.checkPassword(ctx, email, req.Body.Password)
	if err != nil {
		return nil, err
	}
	if !ok {
		s.loginFailures.Add(email)
		return nil, problem.InvalidCredentials()
	}
	s.loginAttempts.Reset(attemptKey)

	m, err := s.q.GetMembership(ctx, userID)
	if err != nil {
		// В MVP у каждого пользователя есть семья (создаётся при регистрации).
		return nil, fmt.Errorf("get membership: %w", err)
	}

	// Старую сессию этого браузера (если была) закрываем: после входа
	// остаётся одна, новая.
	if old := sessionTokenFrom(ctx); old != "" {
		if err := s.q.DeleteSession(ctx, auth.HashToken(old)); err != nil {
			return nil, fmt.Errorf("delete previous session: %w", err)
		}
	}
	token, expires, err := s.createSession(ctx, s.q, userID, s.now())
	if err != nil {
		return nil, err
	}

	me, err := s.me(ctx, userID, m.FamilyID)
	if err != nil {
		return nil, err
	}
	cookie := s.sessionCookie(token, expires).String()
	return oapi.Login200JSONResponse{Body: me, Headers: oapi.Login200ResponseHeaders{SetCookie: &cookie}}, nil
}

// checkPassword проверяет e-mail и пароль. Если пользователя нет (или у него
// нет пароля), пароль всё равно проверяется — против фиктивного хеша: время
// ответа не должно выдавать, зарегистрирован ли e-mail.
func (s *server) checkPassword(ctx context.Context, email, password string) (uuid.UUID, bool, error) {
	row, err := s.q.GetUserCredentialsByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && row.PasswordHash == nil) {
		_, _ = auth.VerifyPassword(s.dummyHash, password)
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("get user credentials: %w", err)
	}
	ok, err := auth.VerifyPassword(*row.PasswordHash, password)
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("verify password of user %s: %w", row.ID, err)
	}
	return row.ID, ok, nil
}

func (s *server) Logout(ctx context.Context, _ oapi.LogoutRequestObject) (oapi.LogoutResponseObject, error) {
	// Выход идемпотентен: нет cookie или сессия уже удалена — всё равно 204.
	if token := sessionTokenFrom(ctx); token != "" {
		if err := s.q.DeleteSession(ctx, auth.HashToken(token)); err != nil {
			return nil, fmt.Errorf("delete session: %w", err)
		}
	}
	cookie := s.clearSessionCookie().String()
	return oapi.Logout204Response{Headers: oapi.Logout204ResponseHeaders{SetCookie: &cookie}}, nil
}

func (s *server) GetMe(ctx context.Context, _ oapi.GetMeRequestObject) (oapi.GetMeResponseObject, error) {
	p := currentUser(ctx)
	me, err := s.me(ctx, p.UserID, p.FamilyID)
	if err != nil {
		return nil, err
	}
	return oapi.GetMe200JSONResponse(me), nil
}

// me собирает ответ Me. Семья фильтруется по familyID из сессии.
func (s *server) me(ctx context.Context, userID, familyID uuid.UUID) (oapi.Me, error) {
	row, err := s.q.GetMe(ctx, dbgen.GetMeParams{UserID: userID, FamilyID: familyID})
	if errors.Is(err, pgx.ErrNoRows) {
		// Пользователя удалили или он сменил семью между проверкой сессии и запросом.
		return oapi.Me{}, problem.Unauthorized()
	}
	if err != nil {
		return oapi.Me{}, fmt.Errorf("get me: %w", err)
	}
	return oapi.Me{
		User: oapi.MeUser{
			Id:            row.UserID,
			Email:         row.Email,
			Name:          row.UserName,
			Timezone:      row.Timezone,
			EmailVerified: row.EmailVerifiedAt != nil,
		},
		Family: oapi.MeFamily{
			Id:          row.FamilyID,
			Name:        row.FamilyName,
			Role:        oapi.FamilyRole(row.Role),
			MemberCount: int(row.MemberCount),
		},
	}, nil
}

// createSession создаёт сессию (в транзакции регистрации или вне её — зависит от q)
// и возвращает токен для cookie и срок действия.
func (s *server) createSession(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, now time.Time) (string, time.Time, error) {
	token, hash := auth.NewToken()
	expires := now.Add(sessionTTL)
	info := clientInfoFrom(ctx)

	var ua *string
	if info.UserAgent != "" {
		ua = &info.UserAgent
	}
	var ip *netip.Addr
	if info.IP.IsValid() {
		ip = &info.IP
	}
	if err := q.CreateSession(ctx, dbgen.CreateSessionParams{
		TokenHash: hash, UserID: userID, UserAgent: ua, Ip: ip, Now: now, ExpiresAt: expires,
	}); err != nil {
		return "", time.Time{}, fmt.Errorf("create session: %w", err)
	}
	return token, expires, nil
}

// normalizeEmail обрезает пробелы и приводит e-mail к нижнему регистру:
// Ivan@Example.com и ivan@example.com — один аккаунт.
func normalizeEmail(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// validTimezone проверяет имя часового пояса IANA («Europe/Moscow»).
// time.LoadLocation принимает ещё "" и "Local" (пояс сервера) — их отклоняем.
func validTimezone(name string) bool {
	if name == "" || name == "Local" {
		return false
	}
	_, err := time.LoadLocation(name)
	return err == nil
}

// isUniqueViolation сообщает, что err — нарушение уникального индекса constraint.
func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolation && pgErr.ConstraintName == constraint
}
