-- Операции. Каждый запрос фильтрует по family_id из сессии и по видимости:
-- операция видна, если виден её счёт (account_id) или счёт-получатель
-- перевода (to_account_id). Счёт виден, если он общий (owner_user_id IS NULL)
-- или личный текущего пользователя. Невидимая операция для API не существует.
--
-- Соединения a (счёт) и ta (счёт-получатель) одинаковы во всех запросах:
-- составной ключ (family_id, id) — тот же, что у внешних ключей операции.
--
-- Условие видимости повторяется в ListTransactions, TransactionDayTotals и
-- GetTransaction (sqlc не умеет общие фрагменты SQL). Меняешь в одном — меняй
-- во всех; тесты видимости проверяют ленту, итоги и чтение по id.

-- name: ListTransactions :many
-- Лента: видимые неудалённые операции под фильтрами, страница по курсору.
-- Порядок (op_date DESC, id DESC) совпадает с индексом transactions_feed_idx;
-- курсор — пара (op_date, id) последней строки предыдущей страницы,
-- сравнение кортежей (a, b) < (c, d) — «строго после неё» в этом порядке.
--
-- Фильтры-массивы: пустой массив — без фильтра. COALESCE нужен, потому что
-- cardinality(NULL) — NULL, а не 0: без него nil-срез из Go отсёк бы всё.
-- Фильтр по счёту учитывает только видимую сторону перевода: иначе по id
-- чужого личного счёта нашлись бы переводы с него и раскрыли бы его существование.
-- Категория верхнего уровня включает подкатегории (c.parent_id = ANY).
-- Поиск: lower с COLLATE pg_c_utf8 — регистр кириллицы не зависит от локали
-- сервера БД; chr(1105) — «ё», chr(1077) — «е» (литералы с кириллицей ломают
-- разбор запроса в sqlc); search приходит уже в нижнем регистре, с заменой
-- ё на е и экранированными спецсимволами LIKE (см. searchPattern в transactions.go).
SELECT t.id, t.kind, t.account_id, t.amount, t.to_account_id, t.to_amount,
       t.category_id, t.op_date, t.comment, t.created_by, t.created_at,
       t.updated_at, t.deleted_at,
       a.owner_user_id AS account_owner_id, a.currency_code AS currency,
       ta.owner_user_id AS to_account_owner_id, ta.currency_code AS to_currency,
       au.name AS author_name, ao.name AS account_owner_name,
       tao.name AS to_account_owner_name
FROM transactions t
JOIN accounts a ON a.family_id = t.family_id AND a.id = t.account_id
LEFT JOIN accounts ta ON ta.family_id = t.family_id AND ta.id = t.to_account_id
LEFT JOIN users au ON au.id = t.created_by
LEFT JOIN users ao ON ao.id = a.owner_user_id
LEFT JOIN users tao ON tao.id = ta.owner_user_id
WHERE t.family_id = @family_id
  AND t.deleted_at IS NULL
  AND (a.owner_user_id IS NULL OR a.owner_user_id = @user_id::uuid
       OR (ta.id IS NOT NULL AND (ta.owner_user_id IS NULL OR ta.owner_user_id = @user_id::uuid)))
  AND (sqlc.narg(date_from)::date IS NULL OR t.op_date >= sqlc.narg(date_from)::date)
  AND (sqlc.narg(date_to)::date IS NULL OR t.op_date <= sqlc.narg(date_to)::date)
  AND (COALESCE(cardinality(@kinds::text[]), 0) = 0 OR t.kind::text = ANY(@kinds::text[]))
  AND (COALESCE(cardinality(@account_ids::uuid[]), 0) = 0
       OR ((a.owner_user_id IS NULL OR a.owner_user_id = @user_id::uuid)
           AND t.account_id = ANY(@account_ids::uuid[]))
       OR ((ta.owner_user_id IS NULL OR ta.owner_user_id = @user_id::uuid)
           AND t.to_account_id = ANY(@account_ids::uuid[])))
  AND (COALESCE(cardinality(@category_ids::uuid[]), 0) = 0
       OR t.category_id IN (SELECT c.id FROM categories c
                            WHERE c.family_id = @family_id
                              AND (c.id = ANY(@category_ids::uuid[])
                                   OR c.parent_id = ANY(@category_ids::uuid[]))))
  AND (COALESCE(cardinality(@author_ids::uuid[]), 0) = 0 OR t.created_by = ANY(@author_ids::uuid[]))
  AND (@search::text = ''
       OR replace(lower(t.comment COLLATE pg_c_utf8), chr(1105), chr(1077)) LIKE '%' || @search::text || '%')
  AND (sqlc.narg(cursor_date)::date IS NULL
       OR (t.op_date, t.id) < (sqlc.narg(cursor_date)::date, sqlc.narg(cursor_id)::uuid))
ORDER BY t.op_date DESC, t.id DESC
LIMIT @row_limit;

-- name: TransactionDayTotals :many
-- Итоги расходов и доходов по дням и валютам под теми же фильтрами, что
-- в ListTransactions (без курсора). only_dates — даты страницы ленты:
-- итог дня считается по всем его операциям, даже если день разрезан
-- границей страницы. Пустой only_dates — все даты (итоги GET /summary
-- складываются из дневных в Go: строк не больше, чем дней × валют).
-- Валюта — валюта счёта: у расхода и дохода сторона одна, и раз операция
-- видна, виден и её счёт. Переводы и корректировки в итоги не входят.
SELECT t.op_date, a.currency_code,
       COALESCE(-SUM(t.amount) FILTER (WHERE t.kind = 'expense'), 0)::bigint AS expense,
       COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'income'), 0)::bigint AS income
FROM transactions t
JOIN accounts a ON a.family_id = t.family_id AND a.id = t.account_id
LEFT JOIN accounts ta ON ta.family_id = t.family_id AND ta.id = t.to_account_id
WHERE t.family_id = @family_id
  AND t.deleted_at IS NULL
  AND t.kind IN ('expense', 'income')
  AND (a.owner_user_id IS NULL OR a.owner_user_id = @user_id::uuid
       OR (ta.id IS NOT NULL AND (ta.owner_user_id IS NULL OR ta.owner_user_id = @user_id::uuid)))
  AND (sqlc.narg(date_from)::date IS NULL OR t.op_date >= sqlc.narg(date_from)::date)
  AND (sqlc.narg(date_to)::date IS NULL OR t.op_date <= sqlc.narg(date_to)::date)
  AND (COALESCE(cardinality(@kinds::text[]), 0) = 0 OR t.kind::text = ANY(@kinds::text[]))
  AND (COALESCE(cardinality(@account_ids::uuid[]), 0) = 0
       OR ((a.owner_user_id IS NULL OR a.owner_user_id = @user_id::uuid)
           AND t.account_id = ANY(@account_ids::uuid[]))
       OR ((ta.owner_user_id IS NULL OR ta.owner_user_id = @user_id::uuid)
           AND t.to_account_id = ANY(@account_ids::uuid[])))
  AND (COALESCE(cardinality(@category_ids::uuid[]), 0) = 0
       OR t.category_id IN (SELECT c.id FROM categories c
                            WHERE c.family_id = @family_id
                              AND (c.id = ANY(@category_ids::uuid[])
                                   OR c.parent_id = ANY(@category_ids::uuid[]))))
  AND (COALESCE(cardinality(@author_ids::uuid[]), 0) = 0 OR t.created_by = ANY(@author_ids::uuid[]))
  AND (@search::text = ''
       OR replace(lower(t.comment COLLATE pg_c_utf8), chr(1105), chr(1077)) LIKE '%' || @search::text || '%')
  AND (COALESCE(cardinality(@only_dates::date[]), 0) = 0 OR t.op_date = ANY(@only_dates::date[]))
GROUP BY t.op_date, a.currency_code
ORDER BY t.op_date DESC, a.currency_code;

-- name: GetTransaction :one
-- Одна видимая операция, включая удалённые (их отличает deleted_at:
-- для всего, кроме restore, удалённая — 404). Колонки — как в ListTransactions,
-- чтобы обе строки преобразовывались одной функцией.
SELECT t.id, t.kind, t.account_id, t.amount, t.to_account_id, t.to_amount,
       t.category_id, t.op_date, t.comment, t.created_by, t.created_at,
       t.updated_at, t.deleted_at,
       a.owner_user_id AS account_owner_id, a.currency_code AS currency,
       ta.owner_user_id AS to_account_owner_id, ta.currency_code AS to_currency,
       au.name AS author_name, ao.name AS account_owner_name,
       tao.name AS to_account_owner_name
FROM transactions t
JOIN accounts a ON a.family_id = t.family_id AND a.id = t.account_id
LEFT JOIN accounts ta ON ta.family_id = t.family_id AND ta.id = t.to_account_id
LEFT JOIN users au ON au.id = t.created_by
LEFT JOIN users ao ON ao.id = a.owner_user_id
LEFT JOIN users tao ON tao.id = ta.owner_user_id
WHERE t.family_id = @family_id
  AND t.id = @id
  AND (a.owner_user_id IS NULL OR a.owner_user_id = @user_id::uuid
       OR (ta.id IS NOT NULL AND (ta.owner_user_id IS NULL OR ta.owner_user_id = @user_id::uuid)));

-- name: LockTransaction :one
-- Блокирует строку операции до конца транзакции (FOR UPDATE OF t — только
-- её, не счета): две одновременные правки одной операции идут по очереди,
-- и снимок «до» в журнале совпадает с тем, что правка действительно заменила.
-- Видимость — та же, что в GetTransaction.
SELECT t.id
FROM transactions t
JOIN accounts a ON a.family_id = t.family_id AND a.id = t.account_id
LEFT JOIN accounts ta ON ta.family_id = t.family_id AND ta.id = t.to_account_id
WHERE t.family_id = @family_id
  AND t.id = @id
  AND (a.owner_user_id IS NULL OR a.owner_user_id = @user_id::uuid
       OR (ta.id IS NOT NULL AND (ta.owner_user_id IS NULL OR ta.owner_user_id = @user_id::uuid)))
FOR UPDATE OF t;

-- name: GetVisibleAccount :one
-- Счёт для операции: семья, видимость; архив и валюту проверяет обработчик.
SELECT id, currency_code, archived_at
FROM accounts
WHERE family_id = @family_id AND id = @id
  AND (owner_user_id IS NULL OR owner_user_id = @user_id::uuid);

-- name: LockFamilyCategoriesShared :exec
-- Разделяемая блокировка категорий семьи (тот же ключ, что у
-- LockFamilyCategories): запись операций друг друга не ждёт, но не
-- пересекается со слиянием и другими изменениями категорий, которые берут
-- исключительную. Так проверенная категория не исчезнет до коммита операции.
SELECT pg_advisory_xact_lock_shared(hashtextextended('categories:' || sqlc.arg(family_id)::uuid::text, 0));

-- name: InsertTransaction :one
INSERT INTO transactions (family_id, kind, account_id, amount, to_account_id, to_amount,
                          category_id, op_date, comment, created_by, created_at, updated_at)
VALUES (@family_id, @kind, @account_id, @amount, sqlc.narg(to_account_id), sqlc.narg(to_amount),
        sqlc.narg(category_id), @op_date, @comment, @created_by::uuid, @now, @now)
RETURNING id;

-- name: UpdateTransaction :exec
UPDATE transactions
SET kind = @kind, account_id = @account_id, amount = @amount,
    to_account_id = sqlc.narg(to_account_id), to_amount = sqlc.narg(to_amount),
    category_id = sqlc.narg(category_id), op_date = @op_date, comment = @comment,
    updated_at = @now
WHERE family_id = @family_id AND id = @id;

-- name: SetTransactionDeleted :exec
-- deleted_at = NULL — восстановление.
UPDATE transactions
SET deleted_at = sqlc.narg(deleted_at), updated_at = @now
WHERE family_id = @family_id AND id = @id;

-- name: LastTransactionAccount :one
-- Счёт последней (по моменту создания: id — uuidv7) неудалённой операции
-- пользователя данного вида на видимом неархивном счёте.
SELECT t.account_id
FROM transactions t
JOIN accounts a ON a.family_id = t.family_id AND a.id = t.account_id
WHERE t.family_id = @family_id
  AND t.created_by = @user_id::uuid
  AND t.kind = @kind
  AND t.deleted_at IS NULL
  AND a.archived_at IS NULL
  AND (a.owner_user_id IS NULL OR a.owner_user_id = @user_id::uuid)
ORDER BY t.id DESC
LIMIT 1;

-- name: LastTransferAccounts :one
-- Пара счетов последнего перевода пользователя, оба видимые и неархивные.
SELECT t.account_id, t.to_account_id::uuid AS to_account_id
FROM transactions t
JOIN accounts a ON a.family_id = t.family_id AND a.id = t.account_id
JOIN accounts ta ON ta.family_id = t.family_id AND ta.id = t.to_account_id
WHERE t.family_id = @family_id
  AND t.created_by = @user_id::uuid
  AND t.kind = 'transfer'
  AND t.deleted_at IS NULL
  AND a.archived_at IS NULL AND ta.archived_at IS NULL
  AND (a.owner_user_id IS NULL OR a.owner_user_id = @user_id::uuid)
  AND (ta.owner_user_id IS NULL OR ta.owner_user_id = @user_id::uuid)
ORDER BY t.id DESC
LIMIT 1;

-- name: FrequentCategories :many
-- Активные категории операций пользователя за 90 дней (date_from..today
-- включительно, обе даты считает обработчик в поясе пользователя; арифметику
-- над параметром sqlc разбирает с ошибкой): самые частые первыми, при
-- равенстве — у кого последняя операция свежее (по дате, затем по моменту
-- создания). Первые 8 каждого вида отбирает обработчик. Операции на
-- невидимых счетах не считаются.
SELECT t.category_id::uuid AS id, c.kind
FROM transactions t
JOIN accounts a ON a.family_id = t.family_id AND a.id = t.account_id
JOIN categories c ON c.family_id = t.family_id AND c.id = t.category_id
WHERE t.family_id = @family_id
  AND t.created_by = @user_id::uuid
  AND t.kind IN ('expense', 'income')
  AND t.deleted_at IS NULL
  AND t.op_date >= @date_from::date
  AND t.op_date <= @today::date
  AND c.archived_at IS NULL
  AND (a.owner_user_id IS NULL OR a.owner_user_id = @user_id::uuid)
GROUP BY t.category_id, c.kind
ORDER BY count(*) DESC, max(t.op_date) DESC, max(t.created_at) DESC, t.category_id;
