-- Токены из писем: подтверждение e-mail и сброс пароля. Как и сессии,
-- хранятся только SHA-256; сам токен есть только в письме.

-- name: LockUserForEmailToken :exec
-- Блокирует строку пользователя до конца транзакции: два одновременных
-- запроса письма выполняют «погасить старые + создать новый» по очереди,
-- и действующим остаётся только последний токен.
SELECT id FROM users
WHERE id = @user_id
FOR UPDATE;

-- name: DeleteEmailTokens :exec
-- Новый токен гасит прежние того же назначения: в любой момент действует
-- только ссылка из последнего письма. Использованные удаляются заодно —
-- они больше ни для чего не нужны.
DELETE FROM email_tokens
WHERE user_id = @user_id AND purpose = @purpose;

-- name: CreateEmailToken :exec
INSERT INTO email_tokens (token_hash, user_id, purpose, email, created_at, expires_at)
VALUES (@token_hash, @user_id, @purpose, @email, @now, @expires_at);

-- name: FindEmailToken :one
-- Действующий токен без погашения: сброс пароля сначала проверяет токен
-- и только потом считает дорогой хеш нового пароля. Токен действует, пока
-- адрес пользователя совпадает с адресом, на который ушло письмо.
SELECT t.user_id
FROM email_tokens t
JOIN users u ON u.id = t.user_id AND u.email = t.email
WHERE t.token_hash = @token_hash
  AND t.purpose = @purpose
  AND t.used_at IS NULL
  AND t.expires_at > @now;

-- name: ConsumeEmailToken :one
-- Погашение одним UPDATE: из двух одновременных запросов с одним токеном
-- второй ждёт блокировку строки, после коммита первого заново проверяет
-- used_at IS NULL и ничего не находит (pgx.ErrNoRows). Использовать токен
-- дважды нельзя.
UPDATE email_tokens t
-- ::timestamptz — иначе sqlc выведет тип по nullable-колонке used_at (*time.Time).
SET used_at = @now::timestamptz
FROM users u
WHERE t.token_hash = @token_hash
  AND t.purpose = @purpose
  AND t.used_at IS NULL
  AND t.expires_at > @now
  AND u.id = t.user_id
  AND u.email = t.email
RETURNING t.user_id, t.email;

-- name: MarkEmailVerified :exec
-- Подтверждается только тот адрес, на который ушло письмо. COALESCE сохраняет
-- момент первого подтверждения.
UPDATE users
SET email_verified_at = COALESCE(email_verified_at, @now),
    updated_at = @now
WHERE id = @user_id AND email = @email;

-- name: SetPasswordHash :exec
UPDATE users
SET password_hash = @password_hash,
    updated_at = @now
WHERE id = @user_id;

-- name: DeleteUserSessions :exec
DELETE FROM sessions
WHERE user_id = @user_id;

-- name: GetUserForEmail :one
-- Данные для письма: адрес, имя и подтверждён ли адрес.
SELECT id, email, name, email_verified_at
FROM users
WHERE id = @user_id;

-- name: GetUserByEmail :one
SELECT id, email, name, email_verified_at
FROM users
WHERE email = lower(@email::text);
