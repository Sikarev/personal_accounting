-- name: ListRateCurrencies :many
-- Валюты, курсы которых загружаются из ЦБ (internal/rates): все, кроме базовой,
-- включая неактивные — по ним могут остаться старые счета. Справочник валют
-- и курсы общие для всех семей, поэтому фильтра по family_id нет.
SELECT code
FROM currencies
WHERE code <> sqlc.arg(base_currency)
ORDER BY code;

-- name: ListLastRateDates :many
-- Последняя загруженная дата курса по каждой валюте, у которой курсы уже есть.
-- max берётся по первичному ключу (currency_code, rate_date) — без сортировки таблицы.
SELECT currency_code, max(rate_date)::date AS last_date
FROM exchange_rates
GROUP BY currency_code;

-- name: UpsertExchangeRates :execrows
-- Записывает курсы одной валюты пачкой: элементы массивов с одним индексом —
-- одна запись. Курс за 1 единицу = value / nominal, округление до 8 знаков —
-- в numeric, без float. Повторная запись идемпотентна; если ЦБ поправил курс,
-- строка обновляется. Число затронутых строк — только новые и изменённые.
-- unnest(a, b, c) sqlc не разбирает, поэтому разворачиваем даты с номером
-- элемента (WITH ORDINALITY, нумерация с 1, как у массивов Postgres)
-- и по нему берём значение и номинал.
INSERT INTO exchange_rates (currency_code, rate_date, rate)
SELECT sqlc.arg(currency_code)::char(3),
       d.rate_date,
       round((sqlc.arg(rate_values)::text[])[d.i]::numeric / (sqlc.arg(nominals)::int[])[d.i], 8)
FROM unnest(sqlc.arg(dates)::date[]) WITH ORDINALITY AS d (rate_date, i)
ON CONFLICT (currency_code, rate_date) DO UPDATE SET rate = EXCLUDED.rate
WHERE exchange_rates.rate <> EXCLUDED.rate;
