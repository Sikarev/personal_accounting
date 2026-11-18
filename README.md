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
    httpapi/        роутер, middleware, обработчики эндпоинтов
    oapi/           сгенерировано oapi-codegen из openapi.yaml
    db/queries/     SQL-запросы для sqlc
    db/dbgen/       сгенерировано sqlc
    problem/        ошибки API (RFC 9457, problem+json)
    testdb/         временные БД для тестов
  migrations/       SQL-миграции (goose), встраиваются в бинарник
web/                React + TypeScript + Vite + Mantine
docs/               документация
docker-compose.yml  Postgres для разработки
```

## Требования

- Go 1.26+
- Node.js 22+, pnpm 12+ (`corepack enable` установит нужную версию из `package.json`)
- Docker Desktop

## Запуск в разработке

```bash
# 1. Postgres
docker compose up -d

# 2. Миграции
cd api && go run ./cmd/migrate up

# 3. API (http://localhost:8080)
cd api && go run ./cmd/api

# 4. Фронт (http://localhost:5173, запросы /api проксируются на API)
cd web && pnpm install && pnpm dev
```

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

Открой этот адрес на телефоне. Запросы `/api` проксирует dev-сервер на компьютере, поэтому API отдельно открывать не нужно. Если страница не открывается, разреши Node.js доступ в частных сетях в брандмауэре Windows (запрос появляется при первом запуске).

Проверяй на телефоне то, что не проверяют автотесты: работу одной рукой, клавиатуру при вводе, поворот экрана, крупный системный шрифт, тёмную тему.

Настройки по умолчанию совпадают с `docker-compose.yml`. `APP_ENV=production` переключает логи API в JSON (по умолчанию — текст). Чтобы их переопределить, скопируй `.env.example` в `.env` (его читает docker compose) и задай переменные окружения для API.

## Бэкенд: генерация кода и тесты

```bash
cd api
go generate ./...   # openapi.yaml → internal/oapi, queries/*.sql → internal/db/dbgen
go test ./...       # нужен запущенный Postgres (docker compose up -d)
```

Генераторы (`oapi-codegen`, `sqlc`) закреплены в `go.mod` и запускаются через `go tool` — ставить их отдельно не нужно. Сгенерированный код коммитится. Порядок добавления эндпоинта — в [docs/api.md](docs/api.md#как-добавить-эндпоинт).

Тесты работают с настоящим Postgres: каждый тестовый пакет создаёт себе временную БД со случайным именем на сервере из `TEST_DATABASE_URL` (по умолчанию — Postgres из `docker-compose.yml`), применяет миграции и удаляет БД после тестов. Если Postgres не запущен, тесты падают с подсказкой.

## Миграции

```bash
cd api
go run ./cmd/migrate status
go run ./cmd/migrate create add_something sql   # создаст migrations/0000N_add_something.sql
go run ./cmd/migrate down                       # откатить последнюю
```
