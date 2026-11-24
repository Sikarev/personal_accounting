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
-- Каждый EXISTS явно указывает deleted_at IS NULL / IS NOT NULL, чтобы попасть
-- в свой частичный индекс (00001 и 00004); без этого условия — полный скан.
-- base_balance — остаток в базовой валюте семьи по курсу на today («сегодня»
-- пользователя): формула и правило выбора курса — как в отчётах (reports.sql,
-- выражение factor). Если у валюты нет ни одного курса, has_base_balance =
-- false (base_balance тогда 0): так sqlc выводит обычные bool и int64, а не
-- interface{} — nullability выражения из LATERAL он не выводит.
SELECT a.id, a.owner_user_id, a.name, a.type, a.currency_code, a.initial_balance,
       a.include_in_total, a.color, a.sort_order, a.archived_at,
       b.balance, b.has_transactions,
       (conv.base_balance IS NOT NULL)::boolean AS has_base_balance,
       COALESCE(conv.base_balance, 0)::bigint AS base_balance
FROM accounts a
CROSS JOIN LATERAL (
    SELECT
       (a.initial_balance
        + COALESCE((SELECT SUM(t.amount) FROM transactions t
                    WHERE t.family_id = a.family_id AND t.account_id = a.id
                      AND t.deleted_at IS NULL), 0)
        + COALESCE((SELECT SUM(t.to_amount) FROM transactions t
                    WHERE t.family_id = a.family_id AND t.to_account_id = a.id
                      AND t.deleted_at IS NULL), 0)
       )::bigint AS balance,
       (EXISTS (SELECT 1 FROM transactions t
                WHERE t.family_id = a.family_id AND t.account_id = a.id
                  AND t.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM transactions t
                   WHERE t.family_id = a.family_id AND t.to_account_id = a.id
                     AND t.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM transactions t
                   WHERE t.family_id = a.family_id AND t.account_id = a.id
                     AND t.deleted_at IS NOT NULL)
        OR EXISTS (SELECT 1 FROM transactions t
                   WHERE t.family_id = a.family_id AND t.to_account_id = a.id
                     AND t.deleted_at IS NOT NULL)
       )::boolean AS has_transactions
) b
LEFT JOIN LATERAL (
    SELECT round(b.balance * CASE WHEN a.currency_code = f.base_currency THEN 1::numeric
                ELSE COALESCE(
                    (SELECT r.rate FROM exchange_rates r
                     WHERE r.currency_code = a.currency_code AND r.rate_date <= @today::date
                     ORDER BY r.rate_date DESC LIMIT 1),
                    (SELECT r.rate FROM exchange_rates r
                     WHERE r.currency_code = a.currency_code AND r.rate_date > @today::date
                     ORDER BY r.rate_date LIMIT 1))
                    * power(10::numeric, (bc.minor_units - c.minor_units)::numeric)
           END)::bigint AS base_balance
    FROM families f
    JOIN currencies bc ON bc.code = f.base_currency
    JOIN currencies c ON c.code = a.currency_code
    WHERE f.id = a.family_id
) conv ON true
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
-- FOR KEY SHARE, который берут вставка операции со ссылкой на счёт (проверка
-- внешнего ключа) и правка, удаление и восстановление операции
-- (LockTransactionAccounts в transactions.sql). Поэтому, пока блокировка
-- держится, ни одна операция по счёту не появляется, не меняется и не
-- исчезает: корректировка считает разницу от остатка, который не изменится
-- до коммита, а удаление счёта не пропустит только что добавленную операцию.
SELECT id, archived_at
FROM accounts
WHERE id = @id AND family_id = @family_id
  AND (owner_user_id IS NULL OR owner_user_id = @user_id::uuid)
FOR UPDATE;

-- name: AccountHasTransactions :one
-- Любые операции, в т. ч. удалённые и где счёт — получатель перевода.
-- Разбито по deleted_at ради частичных индексов (см. ListAccounts).
SELECT (EXISTS (SELECT 1 FROM transactions t
               WHERE t.family_id = @family_id AND t.account_id = @account_id
                 AND t.deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM transactions t
               WHERE t.family_id = @family_id AND t.to_account_id = @account_id
                 AND t.deleted_at IS NULL)
    OR EXISTS (SELECT 1 FROM transactions t
               WHERE t.family_id = @family_id AND t.account_id = @account_id
                 AND t.deleted_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM transactions t
               WHERE t.family_id = @family_id AND t.to_account_id = @account_id
                 AND t.deleted_at IS NOT NULL))::boolean AS has_transactions;

-- name: DeleteAccount :exec
DELETE FROM accounts
WHERE id = @id AND family_id = @family_id
  AND (owner_user_id IS NULL OR owner_user_id = @user_id::uuid);

-- name: GetUserTimezone :one
-- Часовой пояс нужен, чтобы посчитать «сегодня» пользователя (users — не
-- доменная таблица семьи, фильтр по family_id не нужен).
SELECT timezone FROM users WHERE id = @id;

-- name: CreateAdjustment :one
-- Операция-корректировка. Запись в журнал изменений (снимок в формате API)
-- добавляет обработчик в той же транзакции — см. writeTransactionAudit.
INSERT INTO transactions (family_id, kind, account_id, amount, op_date,
                          created_by, created_at, updated_at)
VALUES (@family_id, 'adjustment', @account_id, @amount, @op_date,
        @created_by::uuid, @now, @now)
RETURNING id;
