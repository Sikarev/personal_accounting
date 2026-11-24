# Домашняя бухгалтерия

SaaS для учёта личных и семейных финансов.

- [Требования к MVP](docs/requirements.md)
- [Модель данных](docs/data-model.md)
- [UI/UX: принципы и стандарты](docs/ux.md)
- [План разработки](docs/roadmap.md)
- [Соглашения API](docs/api.md)
- [Handoff: текущее состояние и следующие задачи](docs/handoff.md)

## Структура

```
api/                Go-бэкенд
  openapi.yaml      контракт API (OpenAPI 3) — источник истины для сервера и клиента
  sqlc.yaml         настройки генерации кода по SQL-запросам
  cmd/api/          HTTP-сервер
  cmd/migrate/      применение миграций БД
  internal/         код приложения (не импортируется извне — правило Go для папки internal)
    config/         настройки из переменных окружения
    httpapi/        роутер, middleware, обработчики эндпоинтов
    auth/           хеширование паролей (argon2id), токены сессий
    ratelimit/      ограничение частоты запросов в памяти процесса
    mail/           письма: SMTP (net/smtp), фоновая отправка, шаблоны
    oapi/           сгенерировано oapi-codegen из openapi.yaml
    db/queries/     SQL-запросы для sqlc
    db/dbgen/       сгенерировано sqlc
    problem/        ошибки API (RFC 9457, problem+json)
    testdb/         временные БД для тестов
  migrations/       SQL-миграции (goose), встраиваются в бинарник
web/                React + TypeScript + Vite + Mantine
docs/               документация
docker-compose.yml  Postgres и Mailpit для разработки
```

## Требования

- Go 1.26+
- Node.js 22+, pnpm 12+ (`corepack enable` установит нужную версию из `package.json`)
- Docker Desktop

## Запуск в разработке

```bash
# 1. Postgres и Mailpit (перехват писем, http://localhost:8025)
docker compose up -d

# 2. Миграции
cd api && go run ./cmd/migrate up

# 3. API (http://localhost:8080)
cd api && go run ./cmd/api

# 4. Фронт (http://localhost:5173, запросы /api проксируются на API)
cd web && pnpm install && pnpm dev
```

Откроется экран входа: зарегистрируйся (письмо подтверждения придёт в Mailpit, см. ниже) — и попадёшь в приложение.

API на другом порту (например, во втором worktree, где :8080 занят) — адрес для прокси задаёт `API_PROXY_TARGET`, а `APP_BASE_URL` API должен указывать на этот dev-сервер, иначе ссылки из писем уведут на чужой фронт:

```bash
cd api && API_ADDR=:8091 APP_BASE_URL=http://localhost:5191 go run ./cmd/api
cd web && API_PROXY_TARGET=http://localhost:8091 pnpm dev --port 5191
```

### Письма в разработке

Письма API (подтверждение e-mail, сброс пароля) уходят в [Mailpit](https://mailpit.axllent.org/) из `docker-compose.yml`: он принимает их по SMTP на порту 1025 и никуда дальше не отправляет. Посмотреть письма — http://localhost:8025 (или API Mailpit: `http://localhost:8025/api/v1/messages`). Ссылки в письмах ведут на `APP_BASE_URL` — по умолчанию dev-сервер фронта `http://localhost:5173`. Ящик хранится в памяти контейнера и очищается при его перезапуске.

Если Mailpit не запущен, API работает, но письма не уходят: ошибка отправки пишется в лог (`mail: send failed`).

Перед шагом 1 должен быть запущен **Docker Desktop**. Если он не запущен, `docker compose` сообщает `failed to connect to the docker API`, а тесты API падают с сообщением `testdb: нет тестовой БД`. Запусти Docker Desktop и повтори.

### После обновления кода (`git pull`, слияние веток)

```bash
docker compose up -d
cd api && go run ./cmd/migrate up   # новые миграции в локальную БД
cd web && pnpm install              # новые зависимости
```

### Проверка на телефоне

Телефон и компьютер — в одной сети Wi-Fi.

```bash
cd web && pnpm dev --host   # Vite покажет адрес Network: http://192.168.x.x:5173
```

Открой этот адрес на телефоне. Запросы `/api` проксирует dev-сервер на компьютере, поэтому API отдельно открывать не нужно. Прокси сохраняет заголовок `Host` (`changeOrigin: false` в `vite.config.ts`): иначе защита от CSRF отклонила бы вход и регистрацию с адреса в локальной сети — по HTTP на такой адрес браузер не присылает `Sec-Fetch-Site`, и API сравнивает `Origin` с `Host`. Если страница не открывается, разреши Node.js доступ в частных сетях в брандмауэре Windows (запрос появляется при первом запуске).

Проверяй на телефоне то, что не проверяют автотесты: работу одной рукой, клавиатуру при вводе, поворот экрана, крупный системный шрифт, тёмную тему.

Настройки по умолчанию совпадают с `docker-compose.yml`. Чтобы их переопределить, скопируй `.env.example` в `.env` (его читает docker compose) и задай переменные окружения для API.

| Переменная | По умолчанию | Что делает |
|---|---|---|
| `APP_ENV` | `development` | `production` — логи в JSON, cookie с `Secure` |
| `API_ADDR` | `:8080` | адрес HTTP-сервера |
| `DATABASE_URL` | Postgres из `docker-compose.yml` | строка подключения к БД |
| `COOKIE_SECURE` | `true` в production, `false` в development | флаг `Secure` у cookie сессии; в production без HTTPS вход не заработает |
| `TRUSTED_PROXIES` | пусто | CIDR или IP обратных прокси через запятую; только им API верит в `X-Forwarded-For` |
| `CSRF_TRUSTED_ORIGINS` | пусто | origin через запятую, с которых разрешены запросы, меняющие данные (нужен, только если фронт на другом origin) |
| `APP_BASE_URL` | `http://localhost:5173`; в production **обязателен** | адрес фронтенда, из него собираются ссылки в письмах (`/verify-email?token=…`, `/reset-password?token=…`) |
| `SMTP_HOST`, `SMTP_PORT` | `localhost`, `1025` (Mailpit) | SMTP-сервер для писем; STARTTLS включается, если сервер его предлагает |
| `SMTP_USERNAME`, `SMTP_PASSWORD` | пусто | логин SMTP; пустой — без входа. С логином нужен TLS (STARTTLS): по открытому соединению `net/smtp` пароль не передаст (кроме localhost) |
| `MAIL_FROM` | `Домашняя бухгалтерия <no-reply@localhost>` | отправитель писем |
| `TEST_DATABASE_URL` | Postgres из `docker-compose.yml` | сервер для временных БД тестов |

Подробнее о сессиях, CSRF, лимитах, реальном IP и письмах — в [docs/api.md](docs/api.md#авторизация).

## Бэкенд: генерация кода и тесты

```bash
cd api
go generate ./...   # openapi.yaml → internal/oapi, queries/*.sql → internal/db/dbgen
go test ./...       # нужен запущенный Postgres (docker compose up -d)
```

Генераторы (`oapi-codegen`, `sqlc`) закреплены в `go.mod` и запускаются через `go tool` — ставить их отдельно не нужно. Сгенерированный код коммитится. Порядок добавления эндпоинта — в [docs/api.md](docs/api.md#как-добавить-эндпоинт).

Тесты работают с настоящим Postgres: каждый тестовый пакет создаёт себе временную БД со случайным именем на сервере из `TEST_DATABASE_URL` (по умолчанию — Postgres из `docker-compose.yml`), применяет миграции и удаляет БД после тестов. Если Postgres не запущен, тесты падают с подсказкой.

## Фронтенд: клиент API

```bash
cd web
pnpm generate:api   # ../api/openapi.yaml → src/shared/api/generated (orval)
```

Запускай после каждого изменения контракта `api/openapi.yaml`. Сгенерированный код коммитится; CI проверяет, что он актуален.

## Миграции

```bash
cd api
go run ./cmd/migrate status
go run ./cmd/migrate create add_something sql   # создаст migrations/0000N_add_something.sql
go run ./cmd/migrate down                       # откатить последнюю
```
