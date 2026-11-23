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

/** Пользователь вошёл: `/me` отвечает профилем. */
export async function mockSignedIn(page: Page, me: Me = meFixture()) {
  await page.route(`**${API}/me`, (route) => route.fulfill({ json: me }))
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
