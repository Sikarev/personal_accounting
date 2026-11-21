-- Индексы по счёту для мягко удалённых операций. Индексы из 00001
-- (transactions_account_idx, transactions_to_account_idx) частичные —
-- WHERE deleted_at IS NULL, поэтому проверка «есть ли у счёта хоть одна
-- операция, включая удалённые» (hasTransactions, удаление счёта) шла полным
-- сканом. Проверка разбита на «есть неудалённые» OR «есть удалённые»:
-- каждая половина попадает в свой частичный индекс. Удалённых операций
-- немного, индексы маленькие.

-- +goose Up
CREATE INDEX transactions_deleted_account_idx
    ON transactions (account_id) WHERE deleted_at IS NOT NULL;
CREATE INDEX transactions_deleted_to_account_idx
    ON transactions (to_account_id) WHERE deleted_at IS NOT NULL AND to_account_id IS NOT NULL;

-- +goose Down
DROP INDEX transactions_deleted_to_account_idx;
DROP INDEX transactions_deleted_account_idx;
