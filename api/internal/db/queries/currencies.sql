-- name: ListActiveCurrencies :many
-- Справочник валют общий для всех семей, поэтому фильтра по family_id здесь нет.
SELECT code, name, symbol, minor_units
FROM currencies
WHERE is_active
ORDER BY code;

-- name: ListCurrencyMinorUnits :many
-- Знаки после запятой всех валют справочника, включая неактивные: у старого
-- счёта может быть валюта, которую уже нельзя выбрать для нового (экспорт).
SELECT code, minor_units
FROM currencies;
