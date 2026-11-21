-- Счета. Каждый запрос фильтрует по family_id и по видимости:
-- пользователь видит общие счета (owner_user_id IS NULL) и свои личные.
-- Невидимый счёт для API не существует — запросы возвращают «нет строк» → 404.

-- name: ListAccounts :many
-- Видимые счета с текущими остатками — одним запросом, без N+1.
-- only_id = NULL — все счета, иначе один (так GetAccount не дублирует
-- длинный список колонок и формулу остатка).
-- Остаток = initial_balance + SUM(amount) там, где счёт account_id,
-- + SUM(to_amount) там, где он to_account_id; только неудалённые операции,
-- без учёта даты. SUM(bigint) в Postgres — numeric, поэтому ::bigint.
-- has_transactions учитывает и удалённые операции: удалить счёт с ними нельзя.
SELECT a.id, a.owner_user_id, a.name, a.type, a.currency_code, a.initial_balance,
       a.include_in_total, a.color, a.sort_order, a.archived_at,
       (a.initial_balance
        + COALESCE((SELECT SUM(t.amount) FROM transactions t
                    WHERE t.family_id = a.family_id AND t.account_id = a.id
                      AND t.deleted_at IS NULL), 0)
        + COALESCE((SELECT SUM(t.to_amount) FROM transactions t
                    WHERE t.family_id = a.family_id AND t.to_account_id = a.id
                      AND t.deleted_at IS NULL), 0)
       )::bigint AS balance,
       (EXISTS (SELECT 1 FROM transactions t
                WHERE t.family_id = a.family_id AND t.account_id = a.id)
        OR EXISTS (SELECT 1 FROM transactions t
                   WHERE t.family_id = a.family_id AND t.to_account_id = a.id)
       )::boolean AS has_transactions
FROM accounts a
WHERE a.family_id = @family_id
  AND (a.owner_user_id IS NULL OR a.owner_user_id = @user_id::uuid)
  AND (sqlc.narg(only_id)::uuid IS NULL OR a.id = sqlc.narg(only_id)::uuid)
ORDER BY a.sort_order, a.created_at, a.id;

-- name: CreateAccount :one
-- Валюта проверяется здесь же: INSERT ... SELECT не вставит строку, если
-- валюта не активна, — тогда «нет строк» и обработчик отвечает 422.
-- sort_order — следующий номер в группе (общие / личные этого пользователя),
-- чтобы новый счёт встал в конец. При одновременном создании номера могут
-- совпасть — порядок тогда определит created_at, это не страшно.
INSERT INTO accounts (family_id, owner_user_id, name, type, currency_code,
                      initial_balance, include_in_total, color, sort_order,
                      created_at, updated_at)
SELECT @family_id, sqlc.narg(owner_user_id)::uuid, @name, @type, c.code,
       @initial_balance, @include_in_total, sqlc.narg(color),
       (SELECT COALESCE(MAX(a.sort_order) + 1, 0)::integer FROM accounts a
        WHERE a.family_id = @family_id
          AND a.owner_user_id IS NOT DISTINCT FROM sqlc.narg(owner_user_id)::uuid),
       @now, @now
FROM currencies c
WHERE c.code = @currency_code AND c.is_active
RETURNING id;

-- name: UpdateAccount :one
UPDATE accounts
SET name = @name, type = @type, initial_balance = @initial_balance,
    include_in_total = @include_in_total, color = sqlc.narg(color), updated_at = @now
WHERE id = @id AND family_id = @family_id
  AND (owner_user_id IS NULL OR owner_user_id = @user_id::uuid)
RETURNING id;

-- name: ArchiveAccount :one
-- Идемпотентно: у уже архивного счёта archived_at и updated_at не меняются.
UPDATE accounts
SET archived_at = COALESCE(archived_at, @now::timestamptz),
    updated_at = CASE WHEN archived_at IS NULL THEN @now ELSE updated_at END
WHERE id = @id AND family_id = @family_id
  AND (owner_user_id IS NULL OR owner_user_id = @user_id::uuid)
RETURNING id;

-- name: UnarchiveAccount :one
UPDATE accounts
SET archived_at = NULL,
    updated_at = CASE WHEN archived_at IS NOT NULL THEN @now ELSE updated_at END
WHERE id = @id AND family_id = @family_id
  AND (owner_user_id IS NULL OR owner_user_id = @user_id::uuid)
RETURNING id;

-- name: ReorderAccounts :execrows
-- sort_order = позиция id в массиве (с 0). Обработчик сравнивает число
-- изменённых строк с длиной массива: если какой-то id не найден среди видимых
-- счетов семьи, транзакция откатывается.
UPDATE accounts
SET sort_order = array_position(@ids::uuid[], id) - 1, updated_at = @now
WHERE family_id = @family_id
  AND (owner_user_id IS NULL OR owner_user_id = @user_id::uuid)
  AND id = ANY(@ids::uuid[]);

-- name: LockAccount :one
-- Блокирует видимый счёт до конца транзакции. FOR UPDATE конфликтует с
-- FOR KEY SHARE, который берёт вставка операции со ссылкой на счёт, поэтому
-- пока блокировка держится, новые операции по счёту ждут: корректировка
-- считает разницу от остатка, который не изменится до коммита, а удаление
-- не пропустит только что добавленную операцию.
SELECT id, archived_at
FROM accounts
WHERE id = @id AND family_id = @family_id
  AND (owner_user_id IS NULL OR owner_user_id = @user_id::uuid)
FOR UPDATE;

-- name: AccountHasTransactions :one
-- Любые операции, в т. ч. удалённые и где счёт — получатель перевода.
SELECT (EXISTS (SELECT 1 FROM transactions t
               WHERE t.family_id = @family_id AND t.account_id = @account_id)
    OR EXISTS (SELECT 1 FROM transactions t
               WHERE t.family_id = @family_id AND t.to_account_id = @account_id))::boolean AS has_transactions;

-- name: DeleteAccount :exec
DELETE FROM accounts
WHERE id = @id AND family_id = @family_id
  AND (owner_user_id IS NULL OR owner_user_id = @user_id::uuid);

-- name: GetUserTimezone :one
-- Часовой пояс нужен, чтобы посчитать «сегодня» пользователя (users — не
-- доменная таблица семьи, фильтр по family_id не нужен).
SELECT timezone FROM users WHERE id = @id;

-- name: CreateAdjustment :one
-- Операция-корректировка и запись о ней в журнале изменений — одним запросом
-- (data-modifying CTE). Снимок в audit_log.after — строка transactions целиком
-- (to_jsonb), с именами колонок БД.
WITH t AS (
    INSERT INTO transactions (family_id, kind, account_id, amount, op_date,
                              created_by, created_at, updated_at)
    VALUES (@family_id, 'adjustment', @account_id, @amount, @op_date,
            @created_by::uuid, @now, @now)
    RETURNING *
)
INSERT INTO audit_log (family_id, actor_user_id, entity_type, entity_id, action, after, created_at)
SELECT t.family_id, t.created_by, 'transaction', t.id, 'create', to_jsonb(t), @now
FROM t
RETURNING entity_id;
