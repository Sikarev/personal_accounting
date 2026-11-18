-- Исправление CHECK transactions_kind_shape: перевод с to_amount = NULL проходил проверку.
-- Условие «to_amount > 0» при NULL даёт NULL, а CHECK считает NULL допустимым
-- значением. Явное «to_amount IS NOT NULL» закрывает эту дыру.
-- ADD CONSTRAINT проверит существующие строки: если в БД уже есть такие переводы,
-- миграция упадёт — их нужно исправить вручную.

-- +goose Up
ALTER TABLE transactions DROP CONSTRAINT transactions_kind_shape;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_shape CHECK (
    (kind = 'expense'
        AND amount < 0 AND category_id IS NOT NULL
        AND to_account_id IS NULL AND to_amount IS NULL)
 OR (kind = 'income'
        AND amount > 0 AND category_id IS NOT NULL
        AND to_account_id IS NULL AND to_amount IS NULL)
 OR (kind = 'transfer'
        AND amount < 0 AND to_amount IS NOT NULL AND to_amount > 0
        AND to_account_id IS NOT NULL AND to_account_id <> account_id
        AND category_id IS NULL)
 OR (kind = 'adjustment'
        AND amount <> 0 AND category_id IS NULL
        AND to_account_id IS NULL AND to_amount IS NULL)
);

-- +goose Down
-- Возвращаем ограничение из 00001_init.sql как есть.
ALTER TABLE transactions DROP CONSTRAINT transactions_kind_shape;
ALTER TABLE transactions ADD CONSTRAINT transactions_kind_shape CHECK (
    (kind = 'expense'
        AND amount < 0 AND category_id IS NOT NULL
        AND to_account_id IS NULL AND to_amount IS NULL)
 OR (kind = 'income'
        AND amount > 0 AND category_id IS NOT NULL
        AND to_account_id IS NULL AND to_amount IS NULL)
 OR (kind = 'transfer'
        AND amount < 0 AND to_amount > 0
        AND to_account_id IS NOT NULL AND to_account_id <> account_id
        AND category_id IS NULL)
 OR (kind = 'adjustment'
        AND amount <> 0 AND category_id IS NULL
        AND to_account_id IS NULL AND to_amount IS NULL)
);
