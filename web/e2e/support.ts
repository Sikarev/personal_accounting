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
 * (без счетов главная показывает онбординг, см. onboarding.spec.ts). Свой мок счетов,
 * зарегистрированный позже, перекрывает этот: Playwright проверяет обработчики
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
}

/** Пользователь не вошёл: `/me` отвечает 401. */
export async function mockSignedOut(page: Page) {
  await page.route(`**${API}/me`, (route) => problem(route, 401, 'unauthorized'))
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
