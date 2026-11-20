package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"personal-accounting/api/internal/auth"
	"personal-accounting/api/internal/db/dbgen"
	"personal-accounting/api/internal/mail"
	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/problem"
)

const (
	// Сроки действия ссылок из писем. Те же сроки написаны в текстах писем
	// (internal/mail/templates.go) — меняются вместе.
	verifyEmailTokenTTL   = 24 * time.Hour
	resetPasswordTokenTTL = time.Hour

	// Маршруты фронтенда, на которые ведут ссылки из писем.
	verifyEmailPath   = "/verify-email"
	resetPasswordPath = "/reset-password"
)

// invalidToken — ответ на неверный, просроченный, использованный токен или
// токен для адреса, который уже сменился. Причину не уточняем: клиенту она
// не нужна (в любом случае — запросить новое письмо).
func invalidToken() *problem.Problem {
	return problem.Validation(problem.FieldError{
		Field: "token", Code: "invalid_token", Message: "Ссылка недействительна или устарела.",
	})
}

func (s *server) VerifyEmail(ctx context.Context, req oapi.VerifyEmailRequestObject) (oapi.VerifyEmailResponseObject, error) {
	now := s.now()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	tok, err := q.ConsumeEmailToken(ctx, dbgen.ConsumeEmailTokenParams{
		Now: now, TokenHash: auth.HashToken(req.Body.Token), Purpose: dbgen.EmailTokenPurposeVerifyEmail,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, invalidToken()
	}
	if err != nil {
		return nil, fmt.Errorf("consume verify token: %w", err)
	}
	if err := q.MarkEmailVerified(ctx, dbgen.MarkEmailVerifiedParams{Now: now, UserID: tok.UserID, Email: tok.Email}); err != nil {
		return nil, fmt.Errorf("mark email verified: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit verify email: %w", err)
	}
	return oapi.VerifyEmail204Response{}, nil
}

func (s *server) ResendVerificationEmail(ctx context.Context, _ oapi.ResendVerificationEmailRequestObject) (oapi.ResendVerificationEmailResponseObject, error) {
	p := currentUser(ctx)
	u, err := s.q.GetUserForEmail(ctx, p.UserID)
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	if u.EmailVerifiedAt != nil {
		// Уже подтверждён — письмо не нужно. Ответ тот же: клиенту
		// достаточно перечитать /me.
		return oapi.ResendVerificationEmail204Response{}, nil
	}

	// Два лимита на пользователя: раз в минуту и 5 в час. Часовой только
	// проверяем, минутный — проверяем и учитываем одним вызовом Allow:
	// он под мьютексом, поэтому из параллельных запросов пройдёт один.
	// Часовой учитываем после — только если письмо действительно уйдёт.
	key := p.UserID.String()
	if retry, ok := s.resendPerHour.Check(key); !ok {
		return nil, problem.TooManyRequests(retry)
	}
	if retry, ok := s.resendPerMinute.Allow(key); !ok {
		return nil, problem.TooManyRequests(retry)
	}
	s.resendPerHour.Add(key)

	token, err := s.issueEmailToken(ctx, p.UserID, u.Email, dbgen.EmailTokenPurposeVerifyEmail)
	if err != nil {
		return nil, err
	}
	s.sendVerifyLetter(ctx, p.UserID, mail.Letter{
		Name: u.Name, Email: u.Email, Link: s.emailLink(verifyEmailPath, token),
	})
	return oapi.ResendVerificationEmail204Response{}, nil
}

func (s *server) RequestPasswordReset(ctx context.Context, req oapi.RequestPasswordResetRequestObject) (oapi.RequestPasswordResetResponseObject, error) {
	// Ответ всегда 202 без тела — есть аккаунт или нет, исчерпан лимит
	// или нет. Иначе по ответу можно было бы проверять, зарегистрирован
	// ли адрес. По той же причине и время ответа не должно зависеть от
	// существования аккаунта: в обоих случаях обработчик только ищет
	// пользователя, а токен создаётся и письмо отправляется в фоне.
	email := normalizeEmail(req.Body.Email)

	// Лимит писем на адрес учитывается до поиска пользователя, для любых
	// адресов одинаково. Превышение ответ не меняет: письмо просто не уходит.
	if _, ok := s.resetPerEmail.Allow(email); !ok {
		return oapi.RequestPasswordReset202Response{}, nil
	}

	u, err := s.q.GetUserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		return oapi.RequestPasswordReset202Response{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user by email: %w", err)
	}

	// Ошибку создания токена клиент не увидит (ответ уже 202), она попадёт
	// в лог; пользователь запросит письмо ещё раз.
	s.mail.SendFunc(func(ctx context.Context) (mail.Message, error) {
		token, err := s.issueEmailToken(ctx, u.ID, u.Email, dbgen.EmailTokenPurposeResetPassword)
		if err != nil {
			return mail.Message{}, err
		}
		return mail.ResetPassword(mail.Letter{Name: u.Name, Email: u.Email, Link: s.emailLink(resetPasswordPath, token)})
	}, mailLogAttrs(ctx, dbgen.EmailTokenPurposeResetPassword, u.ID)...)
	return oapi.RequestPasswordReset202Response{}, nil
}

func (s *server) ConfirmPasswordReset(ctx context.Context, req oapi.ConfirmPasswordResetRequestObject) (oapi.ConfirmPasswordResetResponseObject, error) {
	hash := auth.HashToken(req.Body.Token)
	now := s.now()

	// Сначала дешёвая проверка токена: дорогой хеш пароля (argon2id) считаем,
	// только если токен действителен. Окончательно токен гасится ниже,
	// в транзакции, — там же повторная проверка закрывает гонку.
	if _, err := s.q.FindEmailToken(ctx, dbgen.FindEmailTokenParams{
		TokenHash: hash, Purpose: dbgen.EmailTokenPurposeResetPassword, Now: now,
	}); errors.Is(err, pgx.ErrNoRows) {
		return nil, invalidToken()
	} else if err != nil {
		return nil, fmt.Errorf("find reset token: %w", err)
	}
	passwordHash := auth.HashPassword(req.Body.Password)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	tok, err := q.ConsumeEmailToken(ctx, dbgen.ConsumeEmailTokenParams{
		Now: now, TokenHash: hash, Purpose: dbgen.EmailTokenPurposeResetPassword,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Параллельный запрос успел использовать токен первым.
		return nil, invalidToken()
	}
	if err != nil {
		return nil, fmt.Errorf("consume reset token: %w", err)
	}
	if err := q.SetPasswordHash(ctx, dbgen.SetPasswordHashParams{PasswordHash: &passwordHash, Now: now, UserID: tok.UserID}); err != nil {
		return nil, fmt.Errorf("set password: %w", err)
	}
	// Письмо дошло до адреса — значит, адрес принадлежит пользователю.
	if err := q.MarkEmailVerified(ctx, dbgen.MarkEmailVerifiedParams{Now: now, UserID: tok.UserID, Email: tok.Email}); err != nil {
		return nil, fmt.Errorf("mark email verified: %w", err)
	}
	// Все сессии, в том числе, возможно, сессия злоумышленника, из-за
	// которой пароль и сбрасывают, — завершаются.
	if err := q.DeleteUserSessions(ctx, tok.UserID); err != nil {
		return nil, fmt.Errorf("delete sessions: %w", err)
	}
	m, err := q.GetMembership(ctx, tok.UserID)
	if err != nil {
		return nil, fmt.Errorf("get membership: %w", err)
	}
	token, expires, err := s.createSession(ctx, q, tok.UserID, now)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit password reset: %w", err)
	}

	// Владелец доказал доступ к почте: прежние неудачные попытки входа
	// (возможно, чужие) не должны мешать ему войти на других устройствах.
	// Ключи «e-mail + IP» с других адресов сбросить нельзя — их не перечислить
	// без перебора, они истекут сами.
	s.loginFailures.Reset(tok.Email)
	s.loginAttempts.Reset(tok.Email + " " + rateLimitKey(clientInfoFrom(ctx).IP))

	me, err := s.me(ctx, tok.UserID, m.FamilyID)
	if err != nil {
		return nil, err
	}
	cookie := s.sessionCookie(token, expires).String()
	return oapi.ConfirmPasswordReset200JSONResponse{
		Body: me, Headers: oapi.ConfirmPasswordReset200ResponseHeaders{SetCookie: &cookie},
	}, nil
}

// issueEmailToken создаёт токен для письма в отдельной транзакции.
func (s *server) issueEmailToken(ctx context.Context, userID uuid.UUID, email string, purpose dbgen.EmailTokenPurpose) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	token, err := s.createEmailToken(ctx, s.q.WithTx(tx), userID, email, purpose, s.now())
	if err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit email token: %w", err)
	}
	return token, nil
}

// createEmailToken гасит прежние токены того же назначения и создаёт новый
// (q — внутри транзакции: оба изменения применяются вместе).
// Токен привязан к адресу: если адрес сменится, токен перестанет действовать.
func (s *server) createEmailToken(ctx context.Context, q *dbgen.Queries, userID uuid.UUID, email string, purpose dbgen.EmailTokenPurpose, now time.Time) (string, error) {
	ttl := verifyEmailTokenTTL
	if purpose == dbgen.EmailTokenPurposeResetPassword {
		ttl = resetPasswordTokenTTL
	}
	if err := q.LockUserForEmailToken(ctx, userID); err != nil {
		return "", fmt.Errorf("lock user: %w", err)
	}
	if err := q.DeleteEmailTokens(ctx, dbgen.DeleteEmailTokensParams{UserID: userID, Purpose: purpose}); err != nil {
		return "", fmt.Errorf("delete old email tokens: %w", err)
	}
	token, hash := auth.NewToken()
	if err := q.CreateEmailToken(ctx, dbgen.CreateEmailTokenParams{
		TokenHash: hash, UserID: userID, Purpose: purpose, Email: email, Now: now, ExpiresAt: now.Add(ttl),
	}); err != nil {
		return "", fmt.Errorf("create email token: %w", err)
	}
	return token, nil
}

// emailLink — ссылка на страницу фронтенда с токеном.
func (s *server) emailLink(path, token string) string {
	return s.appBaseURL + path + "?token=" + url.QueryEscape(token)
}

// sendLetter отправляет письмо подтверждения e-mail в фоне. Ошибка сборки
// (ошибка в шаблоне) и ошибка отправки пишутся в лог; запрос пользователя
// они не проваливают: токен уже создан, письмо можно запросить ещё раз.
func (s *server) sendVerifyLetter(ctx context.Context, userID uuid.UUID, l mail.Letter) {
	s.mail.SendFunc(func(context.Context) (mail.Message, error) {
		return mail.VerifyEmail(l)
	}, mailLogAttrs(ctx, dbgen.EmailTokenPurposeVerifyEmail, userID)...)
}

// mailLogAttrs — поля записи в логе об отправке письма. В лог не попадают
// ни токен, ни ссылка, ни адрес — только user_id.
func mailLogAttrs(ctx context.Context, purpose dbgen.EmailTokenPurpose, userID uuid.UUID) []slog.Attr {
	return []slog.Attr{
		slog.String("kind", string(purpose)),
		slog.String("user_id", userID.String()),
		slog.String("request_id", middleware.GetReqID(ctx)),
	}
}
