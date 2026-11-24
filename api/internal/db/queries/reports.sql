-- Отчёты в базовой валюте семьи (docs/api.md → «Отчёты», «Пересчёт валют»).
-- Каждый запрос фильтрует по family_id и по видимости счетов: общий
-- (owner_user_id IS NULL) или личный текущего пользователя.
--
-- Пересчёт. Множитель валюты cur на дату d («factor») переводит минимальные
-- единицы cur в минимальные единицы базовой валюты:
--   1                                       — cur и есть базовая;
--   курс × 10^(minor_units базы − minor_units cur) — иначе.
-- Курс — последний с rate_date ≤ d, а если такого нет (дата раньше истории
-- курсов) — первый с rate_date > d. Оба подзапроса идут по первичному ключу
-- exchange_rates (currency_code, rate_date). Нет ни одного курса — factor
-- NULL: такие суммы в итоги не входят (SUM пропускает NULL), а код валюты
-- попадает в missing.
-- В exchange_rates — «рублей за 1 единицу», поэтому формула верна только для
-- базовой валюты RUB (в MVP другой нет).
--
-- Сначала операции складываются в группы g (валюта, дата и категория или
-- счёт). Множитель считается в CTE fx — один раз на уникальную пару
-- (валюта, дата) — и присоединяется к группам. fx — MATERIALIZED: иначе
-- планировщик подставил бы выражение factor в каждое место, где оно нужно
-- (SUM, оконная SUM, FILTER для missing), и искал бы курс по разу на
-- каждое (замер — в docs/api.md → «Отчёты»).
--
-- Суммы — numeric (SUM(bigint) в Postgres — numeric), умножение на курс
-- точное; округление round(numeric) (половина — от нуля) — один раз на
-- каждое число ответа.
--
-- CTE fx повторяется во всех запросах (sqlc не умеет общие фрагменты SQL).
-- Меняешь в одном — меняй во всех, включая ListAccounts в accounts.sql;
-- тесты пересчёта проверяют каждый отчёт.

-- name: GetFamilyBaseCurrency :one
SELECT base_currency::text AS code FROM families WHERE id = @family_id;

-- name: CategoryReport :many
-- Расходы или доходы по категориям: каждая операция — в своей категории
-- (без сворачивания подкатегорий в родителя). Переводы и корректировки
-- отсекает условие по виду. У расхода и дохода счёт один, и раз он видим —
-- видна и операция. Фильтр по счёту — только видимые счета: чужой личный id
-- ничего не находит.
-- total — точная сумма всех категорий (оконная SUM поверх групповой),
-- округлённая один раз.
WITH base AS (
    SELECT f.base_currency AS code, c.minor_units
    FROM families f
    JOIN currencies c ON c.code = f.base_currency
    WHERE f.id = @family_id
),
g AS (
    SELECT t.category_id, a.currency_code AS cur, t.op_date, SUM(abs(t.amount)) AS amount
    FROM transactions t
    JOIN accounts a ON a.family_id = t.family_id AND a.id = t.account_id
    WHERE t.family_id = @family_id
      AND t.deleted_at IS NULL
      AND t.kind::text = @kind::text
      AND (a.owner_user_id IS NULL OR a.owner_user_id = @user_id::uuid)
      AND t.op_date >= @date_from::date
      AND t.op_date <= @date_to::date
      AND (COALESCE(cardinality(@account_ids::uuid[]), 0) = 0 OR t.account_id = ANY(@account_ids::uuid[]))
      AND (COALESCE(cardinality(@author_ids::uuid[]), 0) = 0 OR t.created_by = ANY(@author_ids::uuid[]))
    GROUP BY t.category_id, a.currency_code, t.op_date
),
fx AS MATERIALIZED (
    SELECT k.cur, k.d,
           CASE WHEN k.cur = base.code THEN 1::numeric
                ELSE COALESCE(
                    (SELECT r.rate FROM exchange_rates r
                     WHERE r.currency_code = k.cur AND r.rate_date <= k.d
                     ORDER BY r.rate_date DESC LIMIT 1),
                    (SELECT r.rate FROM exchange_rates r
                     WHERE r.currency_code = k.cur AND r.rate_date > k.d
                     ORDER BY r.rate_date LIMIT 1))
                    * power(10::numeric, (base.minor_units - c.minor_units)::numeric)
           END AS factor
    FROM (SELECT DISTINCT g.cur, g.op_date AS d FROM g) k
    CROSS JOIN base
    JOIN currencies c ON c.code = k.cur
),
conv AS (
    SELECT g.category_id, g.cur, g.amount * fx.factor AS base_amount
    FROM g
    JOIN fx ON fx.cur = g.cur AND fx.d = g.op_date
)
SELECT conv.category_id::uuid AS category_id,
       COALESCE(round(SUM(conv.base_amount)), 0)::bigint AS amount,
       COALESCE(round(SUM(SUM(conv.base_amount)) OVER ()), 0)::bigint AS total,
       COALESCE(array_agg(DISTINCT conv.cur::text) FILTER (WHERE conv.base_amount IS NULL), '{}')::text[] AS missing
FROM conv
GROUP BY conv.category_id
ORDER BY 2 DESC, 1;

-- name: MonthlyReport :many
-- Расходы и доходы по месяцам, в которых есть операции (пустые месяцы
-- добавляет обработчик). Фильтры — как в CategoryReport.
WITH base AS (
    SELECT f.base_currency AS code, c.minor_units
    FROM families f
    JOIN currencies c ON c.code = f.base_currency
    WHERE f.id = @family_id
),
g AS (
    SELECT a.currency_code AS cur, t.op_date,
           COALESCE(-SUM(t.amount) FILTER (WHERE t.kind = 'expense'), 0) AS expense,
           COALESCE(SUM(t.amount) FILTER (WHERE t.kind = 'income'), 0) AS income
    FROM transactions t
    JOIN accounts a ON a.family_id = t.family_id AND a.id = t.account_id
    WHERE t.family_id = @family_id
      AND t.deleted_at IS NULL
      AND t.kind IN ('expense', 'income')
      AND (a.owner_user_id IS NULL OR a.owner_user_id = @user_id::uuid)
      AND t.op_date >= @date_from::date
      AND t.op_date <= @date_to::date
      AND (COALESCE(cardinality(@account_ids::uuid[]), 0) = 0 OR t.account_id = ANY(@account_ids::uuid[]))
      AND (COALESCE(cardinality(@author_ids::uuid[]), 0) = 0 OR t.created_by = ANY(@author_ids::uuid[]))
    GROUP BY a.currency_code, t.op_date
),
-- Пары (валюта, дата) в g уже уникальны, DISTINCT не нужен.
fx AS MATERIALIZED (
    SELECT g.cur, g.op_date AS d,
           CASE WHEN g.cur = base.code THEN 1::numeric
                ELSE COALESCE(
                    (SELECT r.rate FROM exchange_rates r
                     WHERE r.currency_code = g.cur AND r.rate_date <= g.op_date
                     ORDER BY r.rate_date DESC LIMIT 1),
                    (SELECT r.rate FROM exchange_rates r
                     WHERE r.currency_code = g.cur AND r.rate_date > g.op_date
                     ORDER BY r.rate_date LIMIT 1))
                    * power(10::numeric, (base.minor_units - c.minor_units)::numeric)
           END AS factor
    FROM g
    CROSS JOIN base
    JOIN currencies c ON c.code = g.cur
),
conv AS (
    SELECT g.cur, g.op_date, g.expense, g.income, fx.factor
    FROM g
    JOIN fx ON fx.cur = g.cur AND fx.d = g.op_date
)
-- date_trunc от timestamp без пояса: от date он взял бы timestamptz,
-- и результат зависел бы от пояса сессии.
SELECT date_trunc('month', conv.op_date::timestamp)::date AS month,
       COALESCE(round(SUM(conv.expense * conv.factor)), 0)::bigint AS expense,
       COALESCE(round(SUM(conv.income * conv.factor)), 0)::bigint AS income,
       COALESCE(array_agg(DISTINCT conv.cur::text) FILTER (WHERE conv.factor IS NULL), '{}')::text[] AS missing
FROM conv
GROUP BY 1
ORDER BY 1;

-- name: BalanceReport :many
-- Сумма остатков счетов на каждую точку (points — даты по возрастанию,
-- последняя — date_to). Без N+1: изменения остатков раскладываются по
-- «корзинам» точек, затем накопительная сумма по корзинам.
--
-- Счета (acc): без account_ids — видимые с include_in_total, включая
-- архивные; с account_ids — ровно указанные видимые. Каждая сторона
-- перевода — изменение своего счёта, поэтому перевод «личный → общий»
-- для другого участника учитывается только общей стороной.
--
-- Корзина операции — первая точка, не раньше её даты: width_bucket(x, points)
-- — число точек ≤ x, а для x = op_date − 1 — число точек раньше op_date.
-- Операции до первой точки и начальный остаток (действует «с начала
-- времён») — в первой корзине; после date_to — не читаются.
-- Остаток в валюте счёта на точку пересчитывается по курсу на её дату.
WITH base AS (
    SELECT f.base_currency AS code, c.minor_units
    FROM families f
    JOIN currencies c ON c.code = f.base_currency
    WHERE f.id = @family_id
),
acc AS (
    SELECT a.id, a.currency_code AS cur, a.initial_balance
    FROM accounts a
    WHERE a.family_id = @family_id
      AND (a.owner_user_id IS NULL OR a.owner_user_id = @user_id::uuid)
      AND CASE WHEN COALESCE(cardinality(@account_ids::uuid[]), 0) = 0 THEN a.include_in_total
               ELSE a.id = ANY(@account_ids::uuid[]) END
),
pts AS (
    SELECT p.d, p.n
    FROM unnest(@points::date[]) WITH ORDINALITY AS p(d, n)
),
deltas AS (
    SELECT acc.cur, width_bucket(t.op_date - 1, @points::date[]) + 1 AS n, SUM(t.amount) AS amount
    FROM acc
    JOIN transactions t ON t.family_id = @family_id AND t.account_id = acc.id
    WHERE t.deleted_at IS NULL AND t.op_date <= @date_to::date
    GROUP BY 1, 2
    UNION ALL
    SELECT acc.cur, width_bucket(t.op_date - 1, @points::date[]) + 1, SUM(t.to_amount)
    FROM acc
    JOIN transactions t ON t.family_id = @family_id AND t.to_account_id = acc.id
    WHERE t.deleted_at IS NULL AND t.op_date <= @date_to::date
    GROUP BY 1, 2
    UNION ALL
    SELECT acc.cur, 1, SUM(acc.initial_balance)
    FROM acc
    GROUP BY 1
),
bal AS (
    SELECT cs.cur, pts.d,
           SUM(SUM(deltas.amount)) OVER (PARTITION BY cs.cur ORDER BY pts.n) AS balance
    FROM (SELECT DISTINCT acc.cur FROM acc) cs
    CROSS JOIN pts
    LEFT JOIN deltas ON deltas.cur = cs.cur AND deltas.n = pts.n
    GROUP BY cs.cur, pts.d, pts.n
),
-- Пары (валюта, точка) в bal уникальны.
fx AS MATERIALIZED (
    SELECT bal.cur, bal.d,
           CASE WHEN bal.cur = base.code THEN 1::numeric
                ELSE COALESCE(
                    (SELECT r.rate FROM exchange_rates r
                     WHERE r.currency_code = bal.cur AND r.rate_date <= bal.d
                     ORDER BY r.rate_date DESC LIMIT 1),
                    (SELECT r.rate FROM exchange_rates r
                     WHERE r.currency_code = bal.cur AND r.rate_date > bal.d
                     ORDER BY r.rate_date LIMIT 1))
                    * power(10::numeric, (base.minor_units - c.minor_units)::numeric)
           END AS factor
    FROM bal
    CROSS JOIN base
    JOIN currencies c ON c.code = bal.cur
)
SELECT bal.d::date AS point,
       COALESCE(round(SUM(bal.balance * fx.factor)), 0)::bigint AS balance,
       COALESCE(array_agg(DISTINCT bal.cur::text) FILTER (WHERE fx.factor IS NULL), '{}')::text[] AS missing
FROM bal
JOIN fx ON fx.cur = bal.cur AND fx.d = bal.d
GROUP BY bal.d
ORDER BY bal.d;
