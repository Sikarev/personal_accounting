# CLAUDE.md

SaaS «Домашняя бухгалтерия»: учёт личных и семейных финансов. Монорепо: `api/` (Go), `web/` (React), `docs/`.

## Прочитай перед работой

| Документ | Когда |
|---|---|
| [docs/handoff.md](docs/handoff.md) | всегда — текущее состояние, принятые решения, техдолг, следующие задачи |
| [docs/requirements.md](docs/requirements.md) | всегда — что и зачем строим, приоритеты P0/P1 |
| [docs/data-model.md](docs/data-model.md) | любая работа с БД, API, видимостью данных |
| [docs/api.md](docs/api.md) | любая работа с API: соглашения, ошибки, проверка запросов, как добавить эндпоинт |
| [docs/ux.md](docs/ux.md) | **любая** работа с интерфейсом — правила обязательны |
| [docs/roadmap.md](docs/roadmap.md) | что делается на текущем этапе |

Если задача противоречит документации — не выбирай молча, сообщи о противоречии в отчёте.

## Команды

Windows, shell — Git Bash / PowerShell. Postgres для разработки и тестов и Mailpit (письма API, http://localhost:8025): `docker compose up -d` из корня.

```bash
# api/
go build ./...
go vet ./...
gofmt -l .                    # должно быть пусто
go generate ./...             # openapi.yaml → internal/oapi, queries/*.sql → internal/db/dbgen; результат коммитится
go test ./...                 # реальный Postgres: временная БД на пакет (TEST_DATABASE_URL)
go run ./cmd/migrate up
go run ./cmd/api              # http://localhost:8080, APP_ENV=production — JSON-логи и Secure-cookie
                              # COOKIE_SECURE, TRUSTED_PROXIES, CSRF_TRUSTED_ORIGINS — см. README

# web/ — только pnpm, не npm/yarn
pnpm install
pnpm dev                      # http://localhost:5173, /api проксируется на :8080 (другой адрес — API_PROXY_TARGET, см. README)
pnpm build                    # tsc -b + vite build
pnpm typecheck                # только tsc -b
pnpm generate:api             # ../api/openapi.yaml → src/shared/api/generated (orval); результат коммитится
pnpm lint                     # oxlint
pnpm format                   # prettier --write; format:check — проверка без записи (CI)
pnpm test                     # vitest: юнит-тесты форматтеров (src/**/*.test.ts)
pnpm storybook                # http://localhost:6006, витрина компонентов; build-storybook — сборка
pnpm exec playwright install chromium   # один раз перед e2e
pnpm test:e2e                 # Playwright: скриншоты (@visual) + axe (@a11y), 375/1280 × светлая/тёмная
pnpm test:a11y                # только @a11y — то, что идёт в CI
pnpm test:e2e:update          # переснять эталоны скриншотов после намеренного изменения UI
```

Playwright сам собирает приложение и поднимает `vite preview` на :4180; порт меняется переменной `E2E_PORT` (например, `E2E_PORT=4181 pnpm test:e2e` в соседнем worktree). Чужой сервер на этом порту не переиспользуется — тест упадёт с ошибкой «порт занят», а не проверит чужую сборку. Эталоны скриншотов (`web/e2e/*-snapshots/*-win32.png`) сняты на Windows: рендеринг шрифтов зависит от ОС, поэтому в CI (Linux, `.github/workflows/web.yml`) запускаются только `@a11y`-тесты. Меняешь UI — переснимай эталоны локально и смотри диф глазами. Сравнение строгое: `maxDiffPixels: 0` и `threshold: 0.005` (порог цвета пикселя; при умолчании Playwright 0.2 устаревшие эталоны проходили) — см. комментарий в `playwright.config.ts`.

Если добавляешь команду (тесты, генерация, Storybook) — допиши её сюда.

## Соглашения

### Общие
- Интерфейс, документация, комментарии в коде и сообщения коммитов — на русском. Идентификаторы — на английском.
- Комментарии объясняют «почему» и неочевидные идиомы (автор осваивает Go — короткие пояснения к идиомам уместны), а не пересказывают код.
- Не добавляй зависимость, если задачу решает пара десятков строк. Новую зависимость упомяни в отчёте с причиной.
- Изменил поведение, команды или структуру — обнови README/документацию в том же изменении.

### Бэкенд (Go)
- Деньги — `int64` в минимальных единицах валюты. Никаких `float`.
- Каждый запрос к доменным таблицам фильтруется по `family_id`. Изоляция семей и видимость личных счетов покрываются тестами.
- Зависимости передаются явно (конструкторы/замыкания), без глобального состояния.
- Миграции — только новые файлы через `go run ./cmd/migrate create <name> sql`; применённые миграции не редактируем. У каждой миграции рабочий `Down`.
- Тесты, которым нужна БД, работают с реальным Postgres, не с моками.

### Фронтенд
- Перед любой работой с UI — [docs/ux.md](docs/ux.md). Экран готов только по чек-листу из раздела 9.
- Цвета, отступы, размеры — только токены темы Mantine. Суммы — только через компонент `Money`, тексты — только из файлов локализации.
- Стиль кода: без точек с запятой, одинарные кавычки — следит Prettier (`pnpm format`).
- Структура `web/src`:
  - `main.tsx` — точка входа: шрифт, стили Mantine, роутер, провайдеры;
  - `theme.ts` — дизайн-токены: тема Mantine, `semanticColors` (доход, проблема, акцент), `layout` (размеры каркаса), `icons` (размеры и толщина иконок), CSS-переменные `--app-*`;
  - `app/` — оболочка: `App.tsx` (маршруты), `AppProviders.tsx`, `navigation.ts` (адреса и пункты меню), `layout/` (AppShell, боковое меню, нижняя панель, статус API, `RouteBoundary` — скелетон и ошибка загрузки ленивых экранов: новый ленивый экран — просто `lazy()` в `App.tsx`, без своего `Suspense`);
  - `pages/` — экраны, по одному файлу на маршрут; `pages/auth/` — вход и регистрация (`AuthPage`, один компонент на `/login` и `/register`), восстановление пароля, подтверждение e-mail и их общая форма (`AuthForm`, `submitErrorState`); `pages/accounts/` — экран «Счета» (формы счёта и корректировки — у `AccountForm` есть `presets` и `compact` для онбординга, оптимистичные действия `useAccountActions`, кэш списка `accountsCache`; грузится лениво); `pages/settings/` — меню настроек (`SettingsPage`) и «Категории» (`CategoriesPage`, грузится лениво), части экрана категорий — в `settings/categories/` (дерево с перетаскиванием `CategoryTree` на `@dnd-kit` + чистая логика `treeProjection`, формы окон, `useCategoryActions` — очередь оптимистичных изменений с отменой, `focusTargets` — куда переводить фокус); `LegalPage` — документы;
  - `features/` — сценарии, которые используются из нескольких экранов:
    - `quick-add`: окно быстрого ввода и `useQuickAdd()`; провайдер стоит в `AppLayout` (только у вошедшего), поэтому при выходе или 401 окно закрывается вместе с оболочкой;
    - `onboarding`: «первый счёт → где вносить операции» на главной. `HomePage` решает, что показать: нет ни одного видимого счёта — шаг 1 `FirstAccountStep` (компактная `AccountForm` с чипами; грузится лениво, общим с «Счетами» чанком), после создания — шаг 2 `QuickAddIntro`. Флага «пройден» нет, шаг 2 — состояние в памяти (`OnboardingProvider` в `AppLayout`, `useOnboarding()`), сбрасывается при уходе с главной; пока он виден, `BottomNav`/`Sidebar` выделяют кнопку быстрого ввода (`data-highlight`). В e2e `mockSignedIn` по умолчанию отдаёт один счёт — иначе главная показывала бы онбординг;
    - `auth`: защита маршрутов (`RequireAuth`, `RedirectIfAuthenticated`), реакция на 401 (`handleUnauthorized`, подключена в `AppProviders` через `createQueryClient({ onUnauthorized })`), выход (`useLogoutAction`), плашка «Подтвердите e-mail», часовой пояс и «сегодня» пользователя (`useTimezone`, `useToday` — «сегодня» считать только через них);
  - `shared/ui/` — базовые компоненты (`Money`, `EmptyState`, `TransactionListSkeleton`, `ResponsiveSheet`, `notifyWithUndo`, `PageHeader` (с `back` — «Назад» на mobile), `AuthLayout`, `PasswordField`, `SortableList` — перетаскивание на `@dnd-kit`, `AccountPicker`, `AccountMark`, `AccountColorPicker`, `CategoryPicker` — частые чипами + поиск, данные пропсом), рядом — `*.stories.tsx` и `*.module.css`;
  - `shared/lib/` — форматтеры (`formatMoney`, `formatOpDate` + `todayIn`, `plural`), хуки (`useDelayedLoading`, `useMobileLayout`, `useFormState`), безопасный адрес возврата после входа (`safeNextPath`), логика Ctrl+Z для тостов (`undoShortcut`), ввод сумм (`parseMoneyInput`/`formatMoneyInput`), группы и итоги счетов (`accounts.ts`), поиск без регистра и ё/е (`normalizeSearch`, `matchesSearch`), дерево категорий из плоского списка (`categoryTree`: `activeTree`, `archivedEntries`, `toMoveIndex` — позиция среди видимых → `index` API, `applyMove`/`applyArchive`/`applyUnarchive` для оптимистичных обновлений); рядом — `*.test.ts`;
  - `shared/i18n/` — словарь `ru.ts` и `useT()`: `const t = useT(); t.nav.home`. Ключи проверяются типами;
  - `shared/api/` — клиент API: `generated/` (orval, руками не править), `http.ts` (fetch-мутатор, `ApiError` с `retryAfterSeconds`, `NetworkError`), `queryClient.ts` (`createQueryClient()` с умолчаниями и `isUnauthorizedError`), `errorText.ts` (тексты ошибок: `apiErrorText`, `fieldErrorTexts`, `tooManyRequestsText`). Импорт — из `shared/api`.
- Запросы к API — только через сгенерированные хуки (`useListCurrencies()` и т. п.), не через `fetch` (исключение — служебный `/healthz` вне контракта). Новый эндпоинт: контракт → `pnpm generate:api` → хук готов.
- Ошибки API в хуках: `ApiError` (сервер ответил не 2xx: `status`, `code`, `detail`, `fieldErrors`, `requestId`, `retryAfterSeconds`) или `NetworkError` (ответа нет). Текст пользователю — `apiErrorText(error, t)`: по `code`, неизвестный код — по `status`; `detail` не показывается. Ошибки полей формы — `form.setErrors(fieldErrorTexts(error, t, overrides))`: текст по коду нарушения из словаря, а не `message` сервера.
- Вход: источник правды — `GET /me` в кэше (`useGetMe()`). 401 на любом запросе (кроме `invalid_credentials`) сбрасывает кэш и ведёт на `/login?next=…`; на публичных страницах (`isPublicPath` в `app/navigation.ts`) — нет. Новый публичный маршрут добавляется и в `isPublicPath`. `next` — только через `safeNextPath` (защита от open redirect).
- `QueryClient`: 4xx не повторяются, сеть и 5xx — один повтор; `staleTime` 30 с; обновление при возврате во вкладку включено; мутации не повторяются.
- Стили компонентов — CSS-модули рядом с компонентом; в них только `var(--mantine-*)` и `var(--app-*)`. Стили Mantine подключены слоем (`styles.layer.css`), поэтому модули перекрывают их без `!important`.
- Мобильная раскладка — `useMobileLayout()` / `MOBILE_LAYOUT_QUERY`: ширина < `sm` **или** телефон в альбомной ориентации (`max-height: 30em` и `pointer: coarse`). Это единый источник для оболочки, тостов и `ResponsiveSheet`; брейкпоинты Mantine (`hiddenFrom`, `@mixin smaller-than`) для переключения mobile/desktop не используем — они не знают про альбомную ориентацию.
- Глобальные правки поверх Mantine — только в `app/global.css` (цвет кольца фокуса, перенос подписей кнопок при крупном шрифте и центрирование подписи у кнопок-ссылок, высота полей `md` 44 px).
- `package.json` → `"sideEffects": ["*.css"]`: без этого реэкспорт из `shared/ui/index.ts` тянул бы `@dnd-kit` и прочее в основной чанк, даже если экран грузится лениво. Модуль с побочным эффектом при импорте (кроме CSS) — не делать.
- Иконки: размеры — `icons.size.*` (rem, растут со шрифтом), толщина — только `icons.stroke`.
- Новый базовый компонент — сразу с историей в Storybook во всех состояниях; новый экран — в `e2e/` (скриншот + axe). Бэкенда под `vite preview` нет: API подменяется `page.route`, помощники (`mockSignedIn`, `mockSignedOut`, `problem`, `expectNoAxeViolations`) — в `e2e/support.ts`. Экраны внутри оболочки требуют входа — в тесте сначала `mockSignedIn(page)`.
- Плейсхолдеры в полях не используем, только подписи (`label`): цвет placeholder Mantine не проходит AA (техдолг №6). Поля форм — `size="md"` (шрифт 16 px: iOS не масштабирует страницу при фокусе; высота 44 px — `global.css`).

## Git

Ветки: `<тип>/<область>-<суть>`, через дефис, латиницей.
- **тип** — `feat`, `fix`, `refactor`, `docs`, `chore`, `test` (как в Conventional Commits);
- **область** — `api` или `web`, только если задача затрагивает одну часть; сквозные задачи — без неё;
- примеры: `feat/api-foundation`, `feat/web-design-system`, `feat/auth`, `fix/api-transfer-check`.

В `main` вливается merge-коммитом (`--no-ff`), чтобы границы задач были видны в истории.

## Работа агентов

Задачи выполняются агентами по схеме «исполнитель → ревьюер → приёмка в основном потоке».

Агент в отдельном worktree получает ветку с автоматическим именем. Первым шагом он переименовывает её в имя из постановки задачи: `git branch -m <имя>`.

**Исполнитель:**
- работает только в рамках своей задачи; заметил проблему вне рамок — опиши в отчёте, не чини;
- перед отчётом сам прогоняет сборку, линтер и тесты затронутых частей;
- коммитит в свою ветку (сообщение на русском, по смыслу);
- отчёт: что сделано, принятые решения и почему, чем проверено (команды и результат), что не сделано или вызывает сомнения. Не преувеличивай: «не проверял» лучше, чем «должно работать».

**Ревьюер:** не правит код, а проверяет изменение по критериям задачи и документации: корректность, изоляция семей и видимость, безопасность, чек-лист UX. Находки — с файлом, строкой и сценарием, в котором проявляется проблема.
