-- +goose Up

-- =====================================================================
-- Справочники
-- =====================================================================

CREATE TABLE currencies (
    code        char(3)  PRIMARY KEY,           -- ISO 4217
    name        text     NOT NULL,
    symbol      text     NOT NULL,
    minor_units smallint NOT NULL,              -- знаков после запятой: 2 → суммы хранятся в копейках/центах
    is_active   boolean  NOT NULL DEFAULT true  -- доступна для новых счетов
);

INSERT INTO currencies (code, name, symbol, minor_units, is_active) VALUES
    ('RUB', 'Российский рубль', '₽', 2, true),
    ('USD', 'Доллар США',       '$', 2, true),
    ('EUR', 'Евро',             '€', 2, false);

-- Курсы ЦБ РФ: сколько рублей стоит 1 единица валюты на дату.
CREATE TABLE exchange_rates (
    currency_code char(3)        NOT NULL REFERENCES currencies (code),
    rate_date     date           NOT NULL,
    rate          numeric(20, 8) NOT NULL CHECK (rate > 0),
    PRIMARY KEY (currency_code, rate_date)
);

-- =====================================================================
-- Пользователи и авторизация
-- =====================================================================

CREATE TABLE users (
    id                uuid        PRIMARY KEY DEFAULT uuidv7(),
    email             text        NOT NULL CHECK (email = lower(email)),
    email_verified_at timestamptz,
    name              text        NOT NULL,
    password_hash     text,                    -- NULL, если входит только через Яндекс/Google
    timezone          text        NOT NULL DEFAULT 'Europe/Moscow',
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TYPE auth_provider AS ENUM ('yandex', 'google');

-- Внешние способы входа (OAuth). Сюда же позже добавится 'telegram'.
CREATE TABLE user_identities (
    id               uuid          PRIMARY KEY DEFAULT uuidv7(),
    user_id          uuid          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider         auth_provider NOT NULL,
    provider_user_id text          NOT NULL,
    email            text,
    created_at       timestamptz   NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id),
    UNIQUE (user_id, provider)
);

-- В cookie лежит случайный токен, в БД — только его SHA-256.
-- Утечка базы не даёт угнать сессии.
CREATE TABLE sessions (
    token_hash   bytea       PRIMARY KEY,
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user_agent   text,
    ip           inet,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TYPE email_token_purpose AS ENUM ('verify_email', 'reset_password');

-- Одноразовые токены из писем (подтверждение e-mail, сброс пароля).
CREATE TABLE email_tokens (
    token_hash bytea               PRIMARY KEY,
    user_id    uuid                NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose    email_token_purpose NOT NULL,
    email      text                NOT NULL,
    created_at timestamptz         NOT NULL DEFAULT now(),
    expires_at timestamptz         NOT NULL,
    used_at    timestamptz
);
CREATE INDEX email_tokens_user_id_idx ON email_tokens (user_id);

-- =====================================================================
-- Семья
-- =====================================================================

CREATE TABLE families (
    id            uuid        PRIMARY KEY DEFAULT uuidv7(),
    name          text        NOT NULL,
    base_currency char(3)     NOT NULL DEFAULT 'RUB' REFERENCES currencies (code),
    plan          text        NOT NULL DEFAULT 'free',  -- задел под биллинг
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE family_role AS ENUM ('owner', 'member');

CREATE TABLE family_members (
    family_id uuid        NOT NULL REFERENCES families (id) ON DELETE CASCADE,
    user_id   uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role      family_role NOT NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (family_id, user_id),
    UNIQUE (user_id)  -- в MVP пользователь состоит ровно в одной семье
);

CREATE TABLE family_invites (
    id         uuid        PRIMARY KEY DEFAULT uuidv7(),
    family_id  uuid        NOT NULL REFERENCES families (id) ON DELETE CASCADE,
    token_hash bytea       NOT NULL UNIQUE,
    created_by uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at    timestamptz,
    used_by    uuid        REFERENCES users (id) ON DELETE SET NULL,
    revoked_at timestamptz
);
CREATE INDEX family_invites_family_id_idx ON family_invites (family_id);

-- =====================================================================
-- Счета
-- =====================================================================

CREATE TYPE account_type AS ENUM (
    'cash', 'card', 'bank_account', 'deposit', 'credit_card', 'other'
);

CREATE TABLE accounts (
    id               uuid         PRIMARY KEY DEFAULT uuidv7(),
    family_id        uuid         NOT NULL REFERENCES families (id) ON DELETE CASCADE,
    -- NULL — общий счёт семьи; иначе личный счёт этого пользователя (виден только ему).
    -- Без ON DELETE: удалить пользователя с личными счетами можно только
    -- после того, как приложение явно разберётся с ними (иначе — риск утечки).
    owner_user_id    uuid         REFERENCES users (id),
    name             text         NOT NULL,
    type             account_type NOT NULL,
    currency_code    char(3)      NOT NULL REFERENCES currencies (code),
    initial_balance  bigint       NOT NULL DEFAULT 0,   -- в минимальных единицах валюты
    include_in_total boolean      NOT NULL DEFAULT true,
    color            text,
    sort_order       integer      NOT NULL DEFAULT 0,
    archived_at      timestamptz,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    updated_at       timestamptz  NOT NULL DEFAULT now(),
    -- Нужен для составных внешних ключей (family_id, account_id) ниже:
    -- так БД гарантирует, что операция и счёт принадлежат одной семье.
    UNIQUE (family_id, id)
);
CREATE INDEX accounts_family_id_idx ON accounts (family_id);

-- =====================================================================
-- Категории
-- =====================================================================

CREATE TYPE category_kind AS ENUM ('expense', 'income');

CREATE TABLE categories (
    id          uuid          PRIMARY KEY DEFAULT uuidv7(),
    family_id   uuid          NOT NULL REFERENCES families (id) ON DELETE CASCADE,
    kind        category_kind NOT NULL,
    parent_id   uuid,         -- NULL — категория верхнего уровня; глубина 2 проверяется в приложении
    name        text          NOT NULL,
    color       text,
    icon        text,
    sort_order  integer       NOT NULL DEFAULT 0,
    archived_at timestamptz,
    created_at  timestamptz   NOT NULL DEFAULT now(),
    updated_at  timestamptz   NOT NULL DEFAULT now(),
    UNIQUE (family_id, id),
    FOREIGN KEY (family_id, parent_id) REFERENCES categories (family_id, id),
    CHECK (parent_id IS NULL OR parent_id <> id)
);
-- Имена уникальны среди «соседей». NULLS NOT DISTINCT — чтобы правило
-- работало и для верхнего уровня (parent_id IS NULL).
CREATE UNIQUE INDEX categories_name_key
    ON categories (family_id, kind, parent_id, name) NULLS NOT DISTINCT;

-- =====================================================================
-- Операции
-- =====================================================================

CREATE TYPE transaction_kind AS ENUM ('expense', 'income', 'transfer', 'adjustment');

-- amount — изменение остатка account_id (со знаком, в минимальных единицах его валюты):
--   expense    : amount < 0
--   income     : amount > 0
--   transfer   : amount < 0 (списание с account_id), to_amount > 0 (зачисление на to_account_id)
--   adjustment : amount ≠ 0
-- Остаток счёта = initial_balance
--              + SUM(amount)    по операциям, где он account_id
--              + SUM(to_amount) по операциям, где он to_account_id.
CREATE TABLE transactions (
    id            uuid             PRIMARY KEY DEFAULT uuidv7(),
    family_id     uuid             NOT NULL REFERENCES families (id) ON DELETE CASCADE,
    kind          transaction_kind NOT NULL,
    account_id    uuid             NOT NULL,
    amount        bigint           NOT NULL,
    to_account_id uuid,
    to_amount     bigint,
    category_id   uuid,
    op_date       date             NOT NULL,
    comment       text             NOT NULL DEFAULT '',
    created_by    uuid             REFERENCES users (id) ON DELETE SET NULL,
    created_at    timestamptz      NOT NULL DEFAULT now(),
    updated_at    timestamptz      NOT NULL DEFAULT now(),
    deleted_at    timestamptz,

    FOREIGN KEY (family_id, account_id)    REFERENCES accounts   (family_id, id),
    FOREIGN KEY (family_id, to_account_id) REFERENCES accounts   (family_id, id),
    FOREIGN KEY (family_id, category_id)   REFERENCES categories (family_id, id),

    CONSTRAINT transactions_kind_shape CHECK (
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
    )
);

-- Лента операций семьи (новые сверху).
CREATE INDEX transactions_feed_idx
    ON transactions (family_id, op_date DESC, id DESC) WHERE deleted_at IS NULL;
-- Остатки и фильтр по счёту.
CREATE INDEX transactions_account_idx
    ON transactions (account_id) WHERE deleted_at IS NULL;
CREATE INDEX transactions_to_account_idx
    ON transactions (to_account_id) WHERE deleted_at IS NULL AND to_account_id IS NOT NULL;
-- Отчёты по категориям и слияние категорий.
CREATE INDEX transactions_category_idx
    ON transactions (category_id) WHERE category_id IS NOT NULL;

-- =====================================================================
-- Журнал изменений
-- =====================================================================

CREATE TYPE audit_action AS ENUM ('create', 'update', 'delete', 'restore');

CREATE TABLE audit_log (
    id            bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    family_id     uuid         NOT NULL REFERENCES families (id) ON DELETE CASCADE,
    actor_user_id uuid         REFERENCES users (id) ON DELETE SET NULL,
    entity_type   text         NOT NULL,  -- 'transaction', 'account', 'category', ...
    entity_id     uuid         NOT NULL,
    action        audit_action NOT NULL,
    before        jsonb,
    after         jsonb,
    created_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_family_idx ON audit_log (family_id, created_at DESC);

-- +goose Down

DROP TABLE audit_log;
DROP TYPE audit_action;
DROP TABLE transactions;
DROP TYPE transaction_kind;
DROP TABLE categories;
DROP TYPE category_kind;
DROP TABLE accounts;
DROP TYPE account_type;
DROP TABLE family_invites;
DROP TABLE family_members;
DROP TYPE family_role;
DROP TABLE families;
DROP TABLE email_tokens;
DROP TYPE email_token_purpose;
DROP TABLE sessions;
DROP TABLE user_identities;
DROP TYPE auth_provider;
DROP TABLE users;
DROP TABLE exchange_rates;
DROP TABLE currencies;
