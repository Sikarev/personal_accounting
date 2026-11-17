# Домашняя бухгалтерия

SaaS для учёта личных и семейных финансов.

- [Требования к MVP](docs/requirements.md)
- [Модель данных](docs/data-model.md)
- [UI/UX: принципы и стандарты](docs/ux.md)
- [План разработки](docs/roadmap.md)

## Структура

```
api/                Go-бэкенд
  cmd/api/          HTTP-сервер
  cmd/migrate/      применение миграций БД
  internal/         код приложения (не импортируется извне — правило Go для папки internal)
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

Настройки по умолчанию совпадают с `docker-compose.yml`. Чтобы их переопределить, скопируй `.env.example` в `.env` (его читает docker compose) и задай переменные окружения для API.

## Миграции

```bash
cd api
go run ./cmd/migrate status
go run ./cmd/migrate create add_something sql   # создаст migrations/0000N_add_something.sql
go run ./cmd/migrate down                       # откатить последнюю
```
