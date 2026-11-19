-- name: CreateUser :one
-- lower() — на стороне БД, чтобы значение точно прошло CHECK (email = lower(email)).
INSERT INTO users (email, name, password_hash, timezone, terms_accepted_at, terms_version)
VALUES (lower(@email::text), @name, @password_hash, @timezone, @terms_accepted_at, @terms_version)
RETURNING id;

-- name: GetUserCredentialsByEmail :one
SELECT u.id, u.password_hash
FROM users u
WHERE u.email = lower(@email::text);

-- name: GetMembership :one
-- Семья пользователя: в MVP он состоит ровно в одной (UNIQUE (user_id) в family_members).
SELECT family_id, role
FROM family_members
WHERE user_id = @user_id;

-- name: CreateFamily :one
INSERT INTO families (name)
VALUES (@name)
RETURNING id;

-- name: AddFamilyMember :exec
INSERT INTO family_members (family_id, user_id, role)
VALUES (@family_id, @user_id, @role);

-- name: CreateCategory :batchexec
-- :batchexec — все категории уходят в БД одним пакетом (pgx.Batch), а не
-- отдельным запросом на каждую. id задаёт приложение, чтобы сослаться на
-- родителя из того же пакета.
INSERT INTO categories (id, family_id, kind, parent_id, name, sort_order)
VALUES (@id, @family_id, @kind, @parent_id, @name, @sort_order);

-- name: CreateSession :exec
INSERT INTO sessions (token_hash, user_id, user_agent, ip, created_at, last_seen_at, expires_at)
VALUES (@token_hash, @user_id, @user_agent, @ip, @now, @now, @expires_at);

-- name: GetSession :one
-- Сессия вместе с семьёй пользователя. users, sessions и family_members — не
-- доменные таблицы семьи, поэтому сессия ищется по хешу токена, а family_id
-- берётся отсюда и дальше фильтрует все доменные запросы.
SELECT s.user_id, s.last_seen_at, s.expires_at, fm.family_id, fm.role
FROM sessions s
JOIN family_members fm ON fm.user_id = s.user_id
WHERE s.token_hash = @token_hash;

-- name: TouchSession :exec
UPDATE sessions
SET last_seen_at = @now, expires_at = @expires_at
WHERE token_hash = @token_hash;

-- name: DeleteSession :exec
DELETE FROM sessions
WHERE token_hash = @token_hash;

-- name: GetMe :one
SELECT u.id AS user_id, u.email, u.name AS user_name, u.timezone, u.email_verified_at,
       f.id AS family_id, f.name AS family_name, fm.role
FROM users u
JOIN family_members fm ON fm.user_id = u.id
JOIN families f ON f.id = fm.family_id
WHERE u.id = @user_id AND f.id = @family_id;
