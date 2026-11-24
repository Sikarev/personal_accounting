import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, type Route } from '@playwright/test'

// Общее для e2e-тестов: подмена API (под `vite preview` бэкенда нет), axe, проверки вёрстки.

/**
 * Ответ `GET /me` (схема `Me` контракта). Своя копия: сгенерированные типы импортируют
 * друг друга без расширений, а e2e проверяется в режиме Node (nodenext), где так нельзя.
 */
export type Me = {
  user: { id: string; email: string; name: string; timezone: string; emailVerified: boolean }
  family: { id: string; name: string; role: 'owner' | 'member'; memberCount: number }
}

export const API = '/api/v1'

export function meFixture(overrides: Partial<Me['user']> = {}): Me {
  return {
    user: {
      id: '01a1faf8-0000-7000-8000-000000000001',
      email: 'anna@example.com',
      name: 'Анна',
      timezone: 'Europe/Moscow',
      emailVerified: true,
      ...overrides,
    },
    family: {
      id: '01a1faf8-0000-7000-8000-000000000002',
      name: 'Семья',
      role: 'owner',
      memberCount: 1,
    },
  }
}

/** Ответ об ошибке в формате API (docs/api.md → «Ошибки»). */
export function problem(
  route: Route,
  status: number,
  code: string,
  options: {
    errors?: { field: string; code: string; message: string }[]
    retryAfter?: number
  } = {},
) {
  return route.fulfill({
    status,
    contentType: 'application/problem+json',
    headers: options.retryAfter !== undefined ? { 'Retry-After': String(options.retryAfter) } : {},
    body: JSON.stringify({
      type: 'about:blank',
      title: 'Error',
      status,
      code,
      ...(options.errors ? { errors: options.errors } : {}),
    }),
  })
}

/**
 * Счёт по умолчанию у вошедшего пользователя (схема `Account` контракта).
 * Нужен, чтобы главная показывала обычный экран, а не онбординг первого счёта.
 */
export const existingAccount = {
  id: '01a1faf8-0000-7000-8000-0000000000a1',
  name: 'Карта',
  type: 'card',
  currency: 'RUB',
  visibility: 'shared',
  initialBalance: 0,
  balance: 0,
  includeInTotal: true,
  color: null,
  sortOrder: 0,
  archivedAt: null,
  hasTransactions: false,
}

/**
 * Пользователь вошёл: `/me` отвечает профилем, а `GET /accounts` — одним счётом
 * (без счетов главная показывает онбординг, см. onboarding.spec.ts). Главной нужны и
 * остальные справочники: операций нет (`GET /transactions` — пустой список), категорий нет,
 * валюты и `defaults` — как у нового пользователя (форма быстрого ввода на desktop).
 * Свой мок, зарегистрированный позже, перекрывает этот: Playwright проверяет обработчики
 * с последнего добавленного. `me` может быть функцией — профиль, меняющийся по ходу теста.
 */
export async function mockSignedIn(page: Page, me: Me | (() => Me) = meFixture()) {
  await page.route(`**${API}/me`, (route) =>
    route.fulfill({ json: typeof me === 'function' ? me() : me }),
  )
  await page.route(`**${API}/accounts`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { items: [existingAccount] } })
      : route.fallback(),
  )
  await page.route(`**${API}/currencies`, (route) => route.fulfill({ json: currenciesFixture }))
  await page.route(`**${API}/categories`, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { items: [] } }) : route.fallback(),
  )
  // Лента с любыми параметрами (`?limit=10` у главной): адрес без учёта строки запроса.
  await page.route(
    (url) => url.pathname === `${API}/transactions`,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { items: [], days: [] } })
        : route.fallback(),
  )
  await page.route(`**${API}/transactions/defaults`, (route) =>
    route.fulfill({ json: emptyDefaults }),
  )
}

/** `GET /transactions/defaults` нового пользователя: умных значений ещё нет. */
export const emptyDefaults = {
  expenseAccountId: null,
  incomeAccountId: null,
  transfer: null,
  frequentCategories: { expense: [], income: [] },
}

/** Пользователь не вошёл: `/me` отвечает 401. */
export async function mockSignedOut(page: Page) {
  await page.route(`**${API}/me`, (route) => problem(route, 401, 'unauthorized'))
}

// ——— Операции ———

/** Схема `Transaction` контракта (своя копия — см. комментарий к `Me`). */
export type Transaction = {
  id: string
  kind: 'expense' | 'income' | 'transfer' | 'adjustment'
  date: string
  accountId: string | null
  amount: number | null
  currency: string | null
  toAccountId: string | null
  toAmount: number | null
  toCurrency: string | null
  categoryId: string | null
  comment: string
  author: { id: string; name: string } | null
  counterparty: { id: string; name: string } | null
  editable: boolean
  createdAt: string
  updatedAt: string
}

/** Схема `Category` контракта. */
export type Category = {
  id: string
  kind: 'expense' | 'income'
  parentId: string | null
  name: string
  sortOrder: number
  archivedAt: string | null
}

let transactionSeq = 0

/**
 * Операция для моков. id растут с каждым вызовом (как uuidv7 — с моментом создания):
 * в ленте с одинаковой датой выше та, что создана позже.
 */
export function transaction(
  overrides: Partial<Transaction> & Pick<Transaction, 'date'>,
): Transaction {
  transactionSeq += 1
  return {
    id: `01a1faf8-0000-7000-9000-${String(transactionSeq).padStart(12, '0')}`,
    kind: 'expense',
    accountId: existingAccount.id,
    amount: 10_000,
    currency: 'RUB',
    toAccountId: null,
    toAmount: null,
    toCurrency: null,
    categoryId: null,
    comment: '',
    author: { id: meFixture().user.id, name: meFixture().user.name },
    counterparty: null,
    editable: true,
    createdAt: '2026-11-23T10:00:00Z',
    updatedAt: '2026-11-23T10:00:00Z',
    ...overrides,
  }
}

type CurrencyTotal = { currency: string; expense: number; income: number }

/** Итоги по валютам, как считает API: только расходы и доходы, по коду валюты. */
function totalsOf(items: Transaction[]): CurrencyTotal[] {
  const byCurrency = new Map<string, CurrencyTotal>()
  for (const item of items) {
    if ((item.kind !== 'expense' && item.kind !== 'income') || item.amount === null) continue
    const currency = item.currency!
    const total = byCurrency.get(currency) ?? { currency, expense: 0, income: 0 }
    total[item.kind] += item.amount
    byCurrency.set(currency, total)
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency))
}

export type FeedMock = {
  /** Неудалённые операции — их меняют DELETE и restore. */
  transactions: Transaction[]
  /** Удалённые (мягко) — для restore. */
  deleted: Transaction[]
  /** Параметры запросов `GET /transactions` в порядке прихода. */
  listRequests: URLSearchParams[]
  /** Ключи запросов («DELETE /transactions/:id») в порядке прихода. */
  received: string[]
  /**
   * Ответить на следующий запрос с этим ключом своим обработчиком; `proceed` —
   * обычная обработка (например, после задержки).
   */
  failNext: Map<string, (route: Route, proceed: () => Promise<void>) => Promise<void>>
  /** Тела `PUT /transactions/{id}`. */
  updates: { id: string; body: Record<string, unknown> }[]
  /** Тела `POST /transactions` (дублирование через быстрый ввод). */
  created: Record<string, unknown>[]
}

/**
 * Подменить API ленты вместе со справочниками: `GET /accounts`, `/categories`, `/currencies`,
 * `/transactions` (фильтры, курсор, итоги дней), `/transactions/summary`, `defaults`, создание,
 * правка, удаление и восстановление. Фильтры и итоги считаются так же, как на сервере
 * (docs/api.md → «Операции»), курсор — позиция последней строки, как в API. Регистрировать
 * после `mockSignedIn`: свой мок `GET /accounts` перекрывает умолчание.
 */
export async function mockFeedApi(
  page: Page,
  data: {
    transactions: Transaction[]
    accounts?: Record<string, unknown>[]
    categories?: Category[]
    pageSize?: number
  },
): Promise<FeedMock> {
  const api: FeedMock = {
    transactions: [...data.transactions],
    deleted: [],
    listRequests: [],
    received: [],
    failNext: new Map(),
    updates: [],
    created: [],
  }
  const categories = data.categories ?? []
  await page.route(`**${API}/currencies`, (route) => route.fulfill({ json: currenciesFixture }))
  const pageSize = data.pageSize ?? 50

  await page.route(`**${API}/accounts`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { items: data.accounts ?? [existingAccount] } })
      : route.fallback(),
  )
  await page.route(`**${API}/categories`, (route) => route.fulfill({ json: { items: categories } }))

  const matches = (params: URLSearchParams) => {
    const from = params.get('from')
    const to = params.get('to')
    const kinds = params.getAll('kind')
    const accounts = params.getAll('accountId')
    const ids = params.getAll('categoryId')
    // Категория верхнего уровня включает подкатегории.
    const withChildren = new Set([
      ...ids,
      ...categories.filter((c) => c.parentId && ids.includes(c.parentId)).map((c) => c.id),
    ])
    const q = (params.get('q') ?? '').trim().toLowerCase().replaceAll('ё', 'е')
    return (item: Transaction) =>
      (!from || item.date >= from) &&
      (!to || item.date <= to) &&
      (!kinds.length || kinds.includes(item.kind)) &&
      (!accounts.length ||
        accounts.includes(item.accountId ?? '') ||
        accounts.includes(item.toAccountId ?? '')) &&
      (!ids.length || withChildren.has(item.categoryId ?? '')) &&
      (!q || item.comment.toLowerCase().replaceAll('ё', 'е').includes(q))
  }
  // Порядок ленты: дата ↓, затем id ↓.
  const sorted = (items: Transaction[]) =>
    [...items].sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.id < b.id ? 1 : -1,
    )

  await page.route(
    (url) => url.pathname.startsWith(`${API}/transactions`),
    async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname.slice(API.length)
      const key = `${request.method()} ${path.replace(/[0-9a-f-]{36}/, ':id')}`
      api.received.push(key)
      const id = path.split('/')[2]
      const proceed = () => respond(route, key, url.searchParams, id)
      const custom = api.failNext.get(key)
      api.failNext.delete(key)
      return custom ? custom(route, proceed) : proceed()
    },
  )

  async function respond(route: Route, key: string, params: URLSearchParams, id: string) {
    switch (key) {
      case 'GET /transactions': {
        api.listRequests.push(params)
        const all = sorted(api.transactions.filter(matches(params)))
        // Курсор — как в API: позиция последней строки страницы («дата|id» в base64url),
        // а не смещение. Удаление строки с прошлой страницы не сдвигает следующую.
        const cursor = params.get('cursor')
        const after = cursor ? Buffer.from(cursor, 'base64url').toString().split('|') : null
        const rest = after
          ? all.filter((i) => i.date < after[0] || (i.date === after[0] && i.id < after[1]))
          : all
        const items = rest.slice(0, pageSize)
        const last = items.at(-1)
        const dates = [...new Set(items.map((i) => i.date))]
        return route.fulfill({
          json: {
            items,
            ...(rest.length > pageSize && last
              ? { nextCursor: Buffer.from(`${last.date}|${last.id}`).toString('base64url') }
              : {}),
            days: dates.map((date) => ({
              date,
              totals: totalsOf(all.filter((i) => i.date === date)),
            })),
          },
        })
      }
      case 'GET /transactions/summary':
        return route.fulfill({
          json: { totals: totalsOf(api.transactions.filter(matches(params))) },
        })
      case 'DELETE /transactions/:id': {
        const found = api.transactions.find((i) => i.id === id)
        if (!found) return problem(route, 404, 'not_found')
        api.transactions = api.transactions.filter((i) => i.id !== id)
        api.deleted.push(found)
        return route.fulfill({ status: 204 })
      }
      case 'POST /transactions/:id/restore': {
        const found = api.deleted.find((i) => i.id === id)
        if (!found) return problem(route, 404, 'not_found')
        api.deleted = api.deleted.filter((i) => i.id !== id)
        api.transactions.push(found)
        return route.fulfill({ json: found })
      }
      case 'GET /transactions/defaults':
        return route.fulfill({
          json: {
            expenseAccountId: null,
            incomeAccountId: null,
            transfer: null,
            frequentCategories: { expense: [], income: [] },
          },
        })
      case 'PUT /transactions/:id': {
        const index = api.transactions.findIndex((i) => i.id === id)
        if (index === -1) return problem(route, 404, 'not_found')
        const body = route.request().postDataJSON()
        api.updates.push({ id, body })
        const updated = { ...api.transactions[index], ...fromBody(body) }
        api.transactions[index] = updated
        return route.fulfill({ json: updated })
      }
      case 'POST /transactions': {
        const body = route.request().postDataJSON()
        api.created.push(body)
        const created = transaction({ ...fromBody(body), date: body.date })
        api.transactions.push(created)
        return route.fulfill({ status: 201, json: created })
      }
    }
    return problem(route, 404, 'not_found')
  }

  /** Поля операции из тела `POST`/`PUT` — валюты по счетам, как на сервере. */
  function fromBody(body: Record<string, unknown>): Partial<Transaction> {
    const currencyOf = (accountId: unknown) =>
      ((data.accounts ?? [existingAccount]).find((a) => a.id === accountId)?.currency as string) ??
      null
    const transfer = body.kind === 'transfer'
    return {
      kind: body.kind as Transaction['kind'],
      date: body.date as string,
      accountId: body.accountId as string,
      amount: body.amount as number,
      currency: currencyOf(body.accountId),
      toAccountId: transfer ? (body.toAccountId as string) : null,
      toAmount: transfer ? ((body.toAmount ?? body.amount) as number) : null,
      toCurrency: transfer ? currencyOf(body.toAccountId) : null,
      categoryId: transfer ? null : ((body.categoryId as string) ?? null),
      comment: (body.comment as string) ?? '',
    }
  }
  return api
}

/** Дождаться шрифта Inter: скриншот с системным шрифтом дал бы нестабильный эталон. */
export async function fontsReady(page: Page) {
  await page.evaluate(() => document.fonts.ready)
}

/**
 * Нарушения axe на странице. `disableRules` — только для известных проблем библиотеки,
 * с комментарием в тесте, почему правило отключено.
 */
export async function expectNoAxeViolations(page: Page, options: { disableRules?: string[] } = {}) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .disableRules(options.disableRules ?? [])
    .analyze()
  // Список нарушений в сообщении об ошибке понятнее, чем «expected 2 to be 0».
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join('; ')})`,
    ),
  ).toEqual([])
}

/** На сколько пикселей страница шире экрана (0 — горизонтального скролла нет). */
export function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

/** Увеличенный системный шрифт (ux.md, раздел 6: до 200 % без поломки вёрстки). */
export async function enlargeFont(page: Page) {
  await page.addStyleTag({ content: 'html { font-size: 200% }' })
  await fontsReady(page)
}

/** Справочник валют (`GET /currencies`). */
export const currenciesFixture = {
  items: [
    { code: 'RUB', name: 'Российский рубль', symbol: '₽', minorUnits: 2 },
    { code: 'USD', name: 'Доллар США', symbol: '$', minorUnits: 2 },
  ],
}

export type MockTransactionsApi = {
  accounts: Record<string, unknown>[]
  categories: Record<string, unknown>[]
  defaults: Record<string, unknown>
  /** Тела запросов `POST /transactions`. */
  created: Record<string, unknown>[]
  /** Id из `DELETE /transactions/{id}`. */
  deleted: string[]
  /** Ответить на следующий `POST /transactions` этим обработчиком. */
  failCreate: ((route: Route) => Promise<void>) | null
  /** Ответить на следующий `DELETE /transactions/{id}` этим обработчиком. */
  failDelete: ((route: Route) => Promise<void>) | null
  /** Задержка ответа `POST /transactions`, мс. */
  createDelay: number
  /** Задержка ответа `GET /transactions/defaults`, мс (скелетон формы). */
  defaultsDelay: number
}

/**
 * Данные быстрого ввода: счета, категории, валюты, `defaults`, создание и удаление операций.
 * Обработчики читают поля `api` при каждом запросе — их можно менять по ходу теста.
 * Вызывать после `mockSignedIn`: свой мок `GET /accounts` перекрывает умолчательный.
 */
export async function mockTransactionsApi(
  page: Page,
  init: Partial<Pick<MockTransactionsApi, 'accounts' | 'categories' | 'defaults'>> = {},
): Promise<MockTransactionsApi> {
  const api: MockTransactionsApi = {
    accounts: init.accounts ?? [existingAccount],
    categories: init.categories ?? [],
    defaults: init.defaults ?? {
      expenseAccountId: null,
      incomeAccountId: null,
      transfer: null,
      frequentCategories: { expense: [], income: [] },
    },
    created: [],
    deleted: [],
    failCreate: null,
    failDelete: null,
    createDelay: 0,
    defaultsDelay: 0,
  }
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  let seq = 0
  await page.route(`**${API}/currencies`, (route) => route.fulfill({ json: currenciesFixture }))
  await page.route(`**${API}/accounts`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { items: api.accounts } })
      : route.fallback(),
  )
  await page.route(`**${API}/categories`, (route) =>
    route.fulfill({ json: { items: api.categories } }),
  )
  await page.route(`**${API}/transactions/defaults`, async (route) => {
    if (api.defaultsDelay) await wait(api.defaultsDelay)
    return route.fulfill({ json: api.defaults })
  })
  await page.route(`**${API}/transactions`, async (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fulfill({ json: { items: [], days: [] } })
    if (api.failCreate) {
      const fail = api.failCreate
      api.failCreate = null
      return fail(route)
    }
    const body = request.postDataJSON()
    api.created.push(body)
    if (api.createDelay) await wait(api.createDelay)
    seq += 1
    const currencyOf = (id: unknown) =>
      (api.accounts.find((a) => a.id === id)?.currency as string | undefined) ?? null
    return route.fulfill({
      status: 201,
      json: {
        id: `01a1faf8-0000-7000-8000-${String(seq).padStart(12, '0')}`,
        kind: body.kind,
        date: body.date,
        accountId: body.accountId,
        amount: body.amount,
        currency: currencyOf(body.accountId),
        toAccountId: body.toAccountId ?? null,
        toAmount: body.toAmount ?? (body.toAccountId ? body.amount : null),
        toCurrency: body.toAccountId ? currencyOf(body.toAccountId) : null,
        categoryId: body.categoryId ?? null,
        comment: body.comment ?? '',
        author: { id: meFixture().user.id, name: meFixture().user.name },
        counterparty: null,
        editable: true,
        createdAt: '2026-11-23T10:00:00Z',
        updatedAt: '2026-11-23T10:00:00Z',
      },
    })
  })
  await page.route(`**${API}/transactions/*-*`, async (route) => {
    if (route.request().method() !== 'DELETE') return problem(route, 404, 'not_found')
    if (api.failDelete) {
      const fail = api.failDelete
      api.failDelete = null
      return fail(route)
    }
    api.deleted.push(new URL(route.request().url()).pathname.split('/').pop()!)
    return route.fulfill({ status: 204 })
  })
  return api
}

/**
 * Ошибки вида «ResizeObserver loop…» (техдолг №36): браузер сообщает о них событием
 * `error` на window, в `pageerror` Playwright они не попадают. Вызывать до `goto`.
 */
export async function collectWindowErrors(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as Window & { __errors?: string[] }
    w.__errors = []
    window.addEventListener('error', (event) => w.__errors!.push(event.message))
  })
  return () => page.evaluate(() => (window as Window & { __errors?: string[] }).__errors ?? [])
}
