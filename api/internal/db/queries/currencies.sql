-- name: ListActiveCurrencies :many
-- Справочник валют общий для всех семей, поэтому фильтра по family_id здесь нет.
SELECT code, name, symbol, minor_units
FROM currencies
WHERE is_active
ORDER BY code;
