-- Отметка о согласии на обработку ПДн и с пользовательским соглашением (152-ФЗ):
-- когда пользователь согласился и с какой версией документов.
-- NULL допустим на уровне схемы (у строк, созданных до миграции, отметки нет),
-- но приложение всегда заполняет оба поля при регистрации.

-- +goose Up
ALTER TABLE users
    ADD COLUMN terms_accepted_at timestamptz,
    ADD COLUMN terms_version     text;

-- +goose Down
ALTER TABLE users
    DROP COLUMN terms_accepted_at,
    DROP COLUMN terms_version;
