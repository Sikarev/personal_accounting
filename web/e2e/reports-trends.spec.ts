import { expect, test, type Page } from '@playwright/test'

import { ru as t } from '../src/shared/i18n/ru.ts'
import {
  enlargeFont,
  existingAccount,
  expectNoAxeViolations,
  fontsReady,
  horizontalOverflow,
  meFixture,
  mockReportsApi,
  mockSignedIn,
  monthsOf,
  problem,
  type BalanceReportBody,
  type MonthlyReportBody,
} from './support.ts'

// Экран «Отчёты», вкладки «По месяцам» и «Баланс»: вывод текстом, график, таблица,
// переход из месяца в ленту, период по умолчанию (12 месяцев), состояния. Часы
// зафиксированы: «сегодня» — 24 ноября 2026, 12 месяцев — декабрь 2025 … ноябрь 2026.

const NOW = new Date('2026-11-24T12:00:00+03:00')

const card = existingAccount
const cash = { ...existingAccount, id: '01a1faf8-0000-7000-8000-0000000000a2', name: 'Наличные' }
const accounts = [card, cash]

const RUB = 100
// Декабрь 2025 … ноябрь 2026, рубли. Итого доходы 1 900 000, расходы 1 438 400, разница
// 461 600; средний расход по 11 полным месяцам (без текущего ноября) — 123 100.
const INCOME = [
  150000, 150000, 165000, 150000, 150000, 210000, 150000, 150000, 150000, 175000, 150000, 150000,
]
const EXPENSE = [
  182300, 96400, 104500, 121000, 98700, 143200, 171900, 88600, 112300, 135800, 99400, 84300,
]

function monthly(params: URLSearchParams, income = INCOME, expense = EXPENSE): MonthlyReportBody {
  const months = monthsOf(params)
  return {
    currency: 'RUB',
    items: months.map((month, i) => ({
      month,
      income: (income[i % income.length] ?? 0) * RUB,
      expense: (expense[i % expense.length] ?? 0) * RUB,
    })),
    missingRates: [],
  }
}

/** Остаток на конец каждого месяца: растёт с 18 400 до 512 300 ₽. */
const BALANCE_12 = [
  18400, 72000, 132500, 161500, 212800, 279600, 257700, 319100, 356800, 396000, 446600, 512300,
]

function lastDay(month: string) {
  const [y, m] = month.split('-').map(Number)
  return `${month.slice(0, 8)}${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/**
 * Шаг по длине периода — как у API: ≤ 31 дня — день, ≤ 184 — неделя, иначе месяц.
 * Запрос из одного дня (`from = to`) — остаток на начало периода: `start`.
 */
function balance(
  params: URLSearchParams,
  values?: (i: number, n: number) => number,
  start = 10_000 * RUB,
): BalanceReportBody {
  const from = params.get('from')!
  const to = params.get('to')!
  if (from === to) {
    return { currency: 'RUB', step: 'day', items: [{ date: to, balance: start }], missingRates: [] }
  }
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1
  let dates: string[]
  let step: BalanceReportBody['step']
  if (days <= 31) {
    step = 'day'
    dates = Array.from({ length: days }, (_, i) =>
      new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10),
    )
  } else {
    step = 'month'
    dates = monthsOf(params).map((m) => (lastDay(m) < to ? lastDay(m) : to))
  }
  const n = dates.length
  const value =
    values ??
    ((i: number) =>
      n === 12
        ? BALANCE_12[i] * RUB
        : 46_430_000 + Math.round(Math.sin(i / 3) * 2_000_000) + i * 15_000)
  return {
    currency: 'RUB',
    step,
    items: dates.map((date, i) => ({ date, balance: value(i, n) })),
    missingRates: [],
  }
}

async function setup(
  page: Page,
  options: {
    monthly?: (params: URLSearchParams) => MonthlyReportBody
    balance?: (params: URLSearchParams) => BalanceReportBody
    memberCount?: number
    accounts?: Record<string, unknown>[]
  } = {},
) {
  await page.clock.setFixedTime(NOW)
  const me = meFixture()
  me.family.memberCount = options.memberCount ?? 1
  await mockSignedIn(page, me)
  return mockReportsApi(page, {
    monthly: options.monthly ?? ((params) => monthly(params)),
    balance: options.balance ?? ((params) => balance(params)),
    accounts: options.accounts ?? accounts,
  })
}

async function openReports(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1, name: t.nav.reports })).toBeVisible()
  await fontsReady(page)
}

const headline = (page: Page) => page.locator('main').getByRole('heading', { level: 2 }).first()

/** Текст с суммами: Intl ставит неразрывные пробелы, в ожидании — обычные. */
const spaced = (text: string) =>
  new RegExp(`^${text.replace(/[$+.*?()[\]\\]/g, '\\$&').replace(/ /g, '\\s*')}$`)

async function monthlyReady(page: Page) {
  await expect(headline(page)).toHaveText(
    spaced('За 12 месяцев доходы больше расходов на 461 600 ₽'),
  )
  await expect(
    page.getByText(spaced('Средний расход — 123 100 ₽ в месяц, по 11 полным месяцам')),
  ).toBeVisible()
  // График отрисован (ResponsiveContainer меряет блок после первого кадра).
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible()
}

/** Основной запрос баланса (запрос остатка на начало — из одного дня). */
const mainBalanceRequests = (requests: URLSearchParams[]) =>
  requests.filter((r) => r.get('from') !== r.get('to'))

async function balanceReady(
  page: Page,
  text = 'На 24 ноября — 512 300 ₽',
  change: string | null = 'С 1 декабря 2025 баланс вырос на 502 300 ₽',
) {
  await expect(headline(page)).toHaveText(spaced(text))
  if (change) await expect(page.getByText(spaced(change))).toBeVisible()
  await expect(page.locator('.recharts-line-curve').first()).toBeVisible()
}

test.describe('по месяцам', () => {
  test('скриншот: вывод, столбцы, таблица', { tag: '@visual' }, async ({ page }) => {
    await setup(page)
    await openReports(page, '/reports/monthly')
    await monthlyReady(page)
    await expect(page).toHaveScreenshot('reports-monthly.png', { fullPage: true })
  })

  test('скриншот при шрифте 200 %', { tag: '@visual' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Крупный шрифт важен на узком экране')
    await setup(page)
    await openReports(page, '/reports/monthly')
    await monthlyReady(page)
    await enlargeFont(page)
    expect(await horizontalOverflow(page)).toBe(0)
    await expect(page).toHaveScreenshot('reports-monthly-font-200.png', { fullPage: true })
  })

  test('12 месяцев по умолчанию, таблица, доступность', { tag: '@a11y' }, async ({ page }) => {
    const api = await setup(page)
    await openReports(page, '/reports/monthly')
    await monthlyReady(page)
    // Умолчание в адрес не пишется; запрос — за 12 месяцев, включая текущий.
    await expect(page).toHaveURL(/\/reports\/monthly$/)
    const request = api.monthlyRequests.at(-1)!
    expect(request.get('from')).toBe('2025-12-01')
    expect(request.get('to')).toBe('2026-11-30')
    await expect(page.getByLabel(t.feed.filters.period)).toHaveValue('last12Months')
    await expectNoAxeViolations(page)
    expect(await horizontalOverflow(page)).toBe(0)

    // Таблица: новые месяцы сверху, «Итого» за период, суммы — ссылки в ленту.
    const table = page.getByRole('table', {
      name: 'Доходы и расходы по месяцам, 1 декабря 2025 – 30 ноября 2026',
    })
    const months = table.locator('tbody th')
    await expect(months).toHaveCount(12)
    await expect(months.first()).toHaveText('Ноябрь 2026')
    await expect(months.last()).toHaveText('Декабрь 2025')
    await expect(table.locator('tfoot th')).toHaveText(t.reports.monthly.table.total)
    await expect(table.locator('tfoot td').first()).toContainText(/1\s900\s000\s₽/)
    await expect(table.getByRole('link', { name: /доходы, Ноябрь 2026$/ })).toHaveText(
      spaced('150 000 ₽ — доходы, Ноябрь 2026'),
    )
    // Декабрь 2025: расходы больше доходов — разница с минусом.
    await expect(table.locator('tbody tr').last()).toContainText('−32 300')
    // На 12 месяцах кнопки «Показать все» нет.
    await expect(page.getByRole('button', { name: /Показать все значения/ })).toHaveCount(0)
  })

  test(
    'сумма месяца ведёт в ленту с видом, счетами и автором',
    { tag: '@a11y' },
    async ({ page }) => {
      const me = meFixture().user.id
      await setup(page, { memberCount: 2 })
      await openReports(page, `/reports/monthly?accountId=${cash.id}&authorId=${me}`)
      await monthlyReady(page)
      // С клавиатуры: ссылка — сумма расходов за март.
      await page.getByRole('link', { name: /расходы, Март 2026$/ }).focus()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('heading', { level: 1, name: t.nav.transactions })).toBeVisible()
      const url = new URL(page.url())
      expect(url.pathname).toBe('/transactions')
      expect([...url.searchParams]).toEqual([
        ['from', '2026-03-01'],
        ['to', '2026-03-31'],
        ['kind', 'expense'],
        ['accountId', cash.id],
        ['authorId', me],
      ])
    },
  )

  test('столбец: мышь — клик в ленту, палец — сначала суммы', async ({ page, isMobile }) => {
    await setup(page)
    await openReports(page, '/reports/monthly')
    await monthlyReady(page)
    // Столбцы доходов — первая серия, расходов — вторая; последний — ноябрь.
    const expenseBars = page.locator('.recharts-bar').nth(1).locator('.recharts-bar-rectangle')
    const october = expenseBars.nth(10)
    // Подпись под графиком: без наведения — последний месяц.
    const readoutTitle = page
      .locator('main p')
      .filter({ hasText: /^\S+ 2026$/ })
      .first()
    await expect(readoutTitle).toHaveText('Ноябрь 2026')
    if (isMobile) {
      await october.tap()
      await expect(page.getByText(t.reports.monthly.tapAgain)).toBeVisible()
      await expect(readoutTitle).toHaveText('Октябрь 2026')
      await expect(page).toHaveURL(/\/reports\/monthly$/)
      await october.tap()
    } else {
      await october.hover()
      // Наведение — суммы месяца под графиком.
      await expect(readoutTitle).toHaveText('Октябрь 2026')
      await october.click()
    }
    await expect(page).toHaveURL(/\/transactions\?from=2026-10-01&to=2026-10-31&kind=expense$/)
  })

  test(
    'расходы больше доходов, разница ниже нуля',
    { tag: ['@visual', '@a11y'] },
    async ({ page }) => {
      await setup(page, {
        monthly: (params) =>
          monthly(params, [90000, 90000, 120000, 90000], [125000, 81000, 97000, 150000]),
      })
      await openReports(page, '/reports/monthly')
      await expect(headline(page)).toHaveText(
        spaced('За 12 месяцев расходы больше доходов на 189 000 ₽'),
      )
      await expect(page.locator('.recharts-reference-line')).toHaveCount(1)
      await expect(page).toHaveScreenshot('reports-monthly-negative.png', { fullPage: true })
      await expectNoAxeViolations(page)
    },
  )

  test('пусто', { tag: ['@visual', '@a11y'] }, async ({ page }) => {
    await setup(page, { monthly: (params) => monthly(params, [0], [0]) })
    await openReports(page, '/reports/monthly')
    await expect(page.getByRole('heading', { name: t.reports.monthly.empty })).toBeVisible()
    await expect(page).toHaveScreenshot('reports-monthly-empty.png', { fullPage: true })
    await expectNoAxeViolations(page)
    await page.locator('main').getByRole('button', { name: t.nav.addTransaction }).click()
    await expect(page.getByRole('dialog', { name: t.quickAdd.title })).toBeVisible()
  })

  test('ошибка загрузки и «Повторить»', { tag: ['@visual', '@a11y'] }, async ({ page }) => {
    const api = await setup(page)
    // Сеть и 5xx клиент повторяет один раз — для экрана ошибки нужно два отказа.
    api.failNext.push(
      (route) => problem(route, 500, 'internal'),
      (route) => problem(route, 500, 'internal'),
    )
    await openReports(page, '/reports/monthly')
    await expect(page.getByRole('heading', { name: t.reports.loadError })).toBeVisible()
    await expect(page.getByText(t.errors.server)).toBeVisible()
    await expect(page).toHaveScreenshot('reports-monthly-error.png', { fullPage: true })
    await expectNoAxeViolations(page)
    await page.getByRole('button', { name: t.errors.retry }).click()
    await monthlyReady(page)
  })

  test('нет курса валюты — предупреждение', { tag: ['@visual', '@a11y'] }, async ({ page }) => {
    await setup(page, { monthly: (params) => ({ ...monthly(params), missingRates: ['USD'] }) })
    await openReports(page, '/reports/monthly')
    await monthlyReady(page)
    await expect(page.getByText(t.reports.missingRates(['USD']))).toBeVisible()
    await expect(page).toHaveScreenshot('reports-monthly-missing-rates.png', { fullPage: true })
    await expectNoAxeViolations(page)
  })

  test(
    'пока грузится новый период, прежний отчёт приглушён и не выдаёт себя за новый',
    { tag: '@a11y' },
    async ({ page }) => {
      await setup(page)
      let release!: () => void
      const released = new Promise<void>((resolve) => (release = resolve))
      await page.route(
        (url) =>
          url.pathname.endsWith('/reports/monthly') &&
          url.searchParams.get('from') === '2026-01-01',
        async (route) => {
          await released
          await route.fallback()
        },
      )
      await openReports(page, '/reports/monthly')
      await monthlyReady(page)
      await page.getByLabel(t.feed.filters.period).selectOption('thisYear')
      await expect(page).toHaveURL(/from=2026-01-01&to=2026-12-31/)

      // Прежние суммы — с прежним заголовком («За 12 месяцев»), блок приглушён и инертен:
      // ссылки по прежним месяцам не работают.
      const stale = page.locator('[data-stale]')
      await expect(stale).toBeVisible()
      await expect(stale).toHaveAttribute('inert', '')
      await expect(headline(page)).toHaveText(
        spaced('За 12 месяцев доходы больше расходов на 461 600 ₽'),
      )
      await expect(page.locator('main [aria-busy="true"]')).toHaveCount(1)
      await expectNoAxeViolations(page)

      release()
      // 2026 год: январь — ноябрь из фикстуры (с декабря по кругу) и декабрь.
      await expect(headline(page)).toHaveText(/^В 2026 году/)
      await expect(stale).toHaveCount(0)
      await expect(
        page.getByRole('table', { name: 'Доходы и расходы по месяцам, 2026 год' }),
      ).toBeVisible()
    },
  )
})

test.describe('период по умолчанию у вкладок', () => {
  test('без явного периода у каждой вкладки своё умолчание, явный — переносится', async ({
    page,
  }) => {
    const api = await setup(page)
    await openReports(page, '/reports/categories')
    await expect(page.getByLabel(t.feed.filters.period)).toHaveValue('thisMonth')
    // Последним может прийти сравнение (1–24 октября) — ищем запрос самого отчёта.
    await expect
      .poll(() =>
        api.requests.some((r) => r.get('from') === '2026-11-01' && r.get('to') === '2026-11-30'),
      )
      .toBe(true)

    await page.getByRole('link', { name: t.reports.tabs.monthly }).click()
    await expect(page).toHaveURL(/\/reports\/monthly$/)
    await monthlyReady(page)
    await expect(page.getByLabel(t.feed.filters.period)).toHaveValue('last12Months')

    // «Этот месяц» на вкладке трендов — не умолчание: пишется в адрес, есть чип.
    await page.getByLabel(t.feed.filters.period).selectOption('thisMonth')
    await expect(page).toHaveURL(/\/reports\/monthly\?from=2026-11-01&to=2026-11-30$/)
    await expect(
      page.getByRole('button', { name: t.feed.filters.remove(t.feed.filters.periods.thisMonth) }),
    ).toBeVisible()
    // Явный период переходит на «Баланс».
    await page.getByRole('link', { name: t.reports.tabs.balance }).click()
    await expect(page).toHaveURL(/\/reports\/balance\?from=2026-11-01&to=2026-11-30$/)
    await expect
      .poll(() => mainBalanceRequests(api.balanceRequests).at(-1)?.get('from'))
      .toBe('2026-11-01')
    // Крестик чипа — к умолчанию вкладки (12 месяцев).
    await page
      .getByRole('button', { name: t.feed.filters.remove(t.feed.filters.periods.thisMonth) })
      .click()
    await expect(page).toHaveURL(/\/reports\/balance$/)
    await balanceReady(page)
  })
})

test.describe('баланс', () => {
  test('скриншот: вывод, линия, таблица', { tag: '@visual' }, async ({ page }) => {
    await setup(page)
    await openReports(page, '/reports/balance')
    await balanceReady(page)
    await expect(page).toHaveScreenshot('reports-balance.png', { fullPage: true })
  })

  test('скриншот при шрифте 200 %', { tag: '@visual' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Крупный шрифт важен на узком экране')
    await setup(page)
    await openReports(page, '/reports/balance')
    await balanceReady(page)
    await enlargeFont(page)
    expect(await horizontalOverflow(page)).toBe(0)
    await expect(page).toHaveScreenshot('reports-balance-font-200.png', { fullPage: true })
  })

  test('без участника: поля нет, в запрос автор не уходит', { tag: '@a11y' }, async ({ page }) => {
    const me = meFixture().user.id
    const api = await setup(page, { memberCount: 2 })
    await openReports(page, `/reports/balance?accountId=${card.id}&authorId=${me}`)
    await balanceReady(page)
    const requests = api.balanceRequests
    // Остаток на начало — тем же отбором счетов, за день до периода.
    expect(
      requests.some((r) => r.get('from') === '2025-11-30' && r.get('to') === '2025-11-30'),
    ).toBe(true)
    expect(requests.every((r) => r.getAll('accountId').join() === card.id)).toBe(true)
    const request = mainBalanceRequests(requests).at(-1)!
    // Конец периода — не позже сегодня.
    expect(request.get('to')).toBe('2026-11-24')
    expect(request.getAll('accountId')).toEqual([card.id])
    expect(request.has('authorId')).toBe(false)
    await expect(page.getByLabel(t.reports.filters.author)).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: t.feed.filters.remove(t.feed.filters.mine) }),
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: t.feed.filters.remove('Карта') })).toBeVisible()
    // На «По месяцам» автор из адреса снова действует.
    await page.getByRole('link', { name: t.reports.tabs.monthly }).click()
    await expect.poll(() => api.monthlyRequests.at(-1)?.getAll('authorId')).toEqual([me])
    await expectNoAxeViolations(page)
  })

  test('шаг день: 30 точек, таблица свёрнута', { tag: ['@visual', '@a11y'] }, async ({ page }) => {
    await setup(page)
    await openReports(page, '/reports/balance?from=2026-11-01&to=2026-11-30')
    await expect(headline(page)).toHaveText(/^На 24 ноября\s—/)
    await expect(page.locator('.recharts-line-curve').first()).toBeVisible()
    await expect(page).toHaveScreenshot('reports-balance-days.png', { fullPage: true })

    // Изменение — от остатка на конец 31 октября, а не от первой точки (1 ноября).
    await expect(page.getByText(/^С 1 ноября баланс/)).toBeVisible()
    const table = page.getByRole('table', { name: 'Общий баланс, 1–24 ноября' })
    await expect(table.locator('tbody tr')).toHaveCount(12)
    await expect(table.locator('tbody th').first()).toHaveText('24 ноября')
    const more = page.getByRole('button', { name: t.reports.table.showAll(24) })
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await more.click()
    await expect(table.locator('tbody tr')).toHaveCount(24)
    await expect(page.getByRole('button', { name: t.reports.table.showLess })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expectNoAxeViolations(page)
    expect(await horizontalOverflow(page)).toBe(0)
  })

  test('шаг месяц за 10 лет: 120 точек', { tag: ['@visual', '@a11y'] }, async ({ page }) => {
    const api = await setup(page)
    await openReports(page, '/reports/balance?from=2016-12-01&to=2026-11-30')
    await expect(headline(page)).toHaveText(/^На 24 ноября\s—/)
    expect(mainBalanceRequests(api.balanceRequests).at(-1)!.get('from')).toBe('2016-12-01')
    await expect(page.locator('.recharts-line-curve').first()).toBeVisible()
    await expect(page).toHaveScreenshot('reports-balance-long.png', { fullPage: true })
    await expect(page.getByRole('button', { name: t.reports.table.showAll(120) })).toBeVisible()
    // Подписи оси — январи с годами, ровным шагом; последний год виден.
    const ticks = page.locator('main svg text').filter({ hasText: /^[а-я]{3}\s*\d{4}$/ })
    await expect(ticks.last()).toHaveText(/^янв\s*2026$/)
    const texts = await ticks.allTextContents()
    expect(texts.length).toBeGreaterThanOrEqual(4)
    for (const text of texts) expect(text).toMatch(/^янв\s*20\d\d$/)
    await expectNoAxeViolations(page)
    expect(await horizontalOverflow(page)).toBe(0)
  })

  test('уход ниже нуля', { tag: ['@visual', '@a11y'] }, async ({ page }) => {
    await setup(page, {
      balance: (params) => balance(params, (i) => (20_000 - i * 5_000) * RUB, 25_000 * RUB),
    })
    await openReports(page, '/reports/balance')
    await balanceReady(
      page,
      'На 24 ноября — −35 000 ₽',
      'С 1 декабря 2025 баланс уменьшился на 60 000 ₽',
    )
    await expect(page.locator('.recharts-reference-line')).toHaveCount(1)
    await expect(page).toHaveScreenshot('reports-balance-negative.png', { fullPage: true })
    await expectNoAxeViolations(page)
  })

  test(
    'нет счетов — объяснение вместо ряда нулей',
    { tag: ['@visual', '@a11y'] },
    async ({ page }) => {
      const api = await setup(page, { accounts: [] })
      await openReports(page, '/reports/balance')
      await expect(
        page.getByRole('heading', { name: t.reports.balance.noAccounts.title }),
      ).toBeVisible()
      await expect(page).toHaveScreenshot('reports-balance-empty.png', { fullPage: true })
      await expectNoAxeViolations(page)
      expect(api.balanceRequests).toHaveLength(0)
      await page.getByRole('link', { name: t.accounts.create }).click()
      await expect(page).toHaveURL(/\/accounts$/)
    },
  )

  test('ни один счёт не в общем балансе', async ({ page }) => {
    await setup(page, { accounts: [{ ...card, includeInTotal: false }] })
    await openReports(page, '/reports/balance')
    await expect(
      page.getByRole('heading', { name: t.reports.balance.noneInTotal.title }),
    ).toBeVisible()
    // Выбранный в фильтре счёт показывается, даже если он не в общем балансе.
    await openReports(page, `/reports/balance?accountId=${card.id}`)
    await balanceReady(page)
  })

  test('ошибка загрузки и «Повторить»', { tag: ['@visual', '@a11y'] }, async ({ page }) => {
    await setup(page)
    // Отказывает основной запрос (два раза — клиент повторяет 5xx один раз); запрос
    // остатка на начало уходит параллельно и отвечает.
    let failures = 2
    await page.route(
      (url) =>
        url.pathname.endsWith('/api/v1/reports/balance') &&
        url.searchParams.get('from') !== url.searchParams.get('to'),
      (route) => (failures-- > 0 ? problem(route, 500, 'internal') : route.fallback()),
    )
    await openReports(page, '/reports/balance')
    await expect(page.getByRole('heading', { name: t.reports.loadError })).toBeVisible()
    await expect(page).toHaveScreenshot('reports-balance-error.png', { fullPage: true })
    await expectNoAxeViolations(page)
    await page.getByRole('button', { name: t.errors.retry }).click()
    await balanceReady(page)
  })

  test(
    'не загрузились счета — ошибка, а не «Счетов пока нет»',
    { tag: ['@visual', '@a11y'] },
    async ({ page }) => {
      const api = await setup(page)
      let failures = 2
      await page.route(`**/api/v1/accounts`, (route) =>
        failures-- > 0 ? problem(route, 500, 'internal') : route.fallback(),
      )
      await openReports(page, '/reports/balance')
      await expect(page.getByRole('heading', { name: t.reports.loadError })).toBeVisible()
      await expect(
        page.getByRole('heading', { name: t.reports.balance.noAccounts.title }),
      ).toHaveCount(0)
      await expect(page.getByRole('link', { name: t.accounts.create })).toHaveCount(0)
      expect(api.balanceRequests).toHaveLength(0)
      await expect(page).toHaveScreenshot('reports-balance-accounts-error.png', { fullPage: true })
      await expectNoAxeViolations(page)
      await page.getByRole('button', { name: t.errors.retry }).click()
      await balanceReady(page)
    },
  )

  test('остаток на начало не загрузился — отчёт без строки изменения', async ({ page }) => {
    await setup(page)
    await page.route(
      (url) =>
        url.pathname.endsWith('/api/v1/reports/balance') &&
        url.searchParams.get('from') === url.searchParams.get('to'),
      (route) => problem(route, 500, 'internal'),
    )
    await openReports(page, '/reports/balance')
    await balanceReady(page, 'На 24 ноября — 512 300 ₽', null)
    await expect(page.getByText(/баланс (вырос|уменьшился|не изменился)/)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: t.reports.loadError })).toHaveCount(0)
  })

  test('период в будущем — объяснение без запроса', { tag: '@a11y' }, async ({ page }) => {
    const api = await setup(page)
    await openReports(page, '/reports/balance?from=2026-12-01&to=2026-12-31')
    await expect(page.getByRole('heading', { name: t.reports.balance.future.title })).toBeVisible()
    // Фильтры и адрес не меняются.
    await expect(page).toHaveURL(/from=2026-12-01&to=2026-12-31$/)
    expect(api.balanceRequests).toHaveLength(0)
    await expectNoAxeViolations(page)
  })

  test('нет курса валюты — про счета', { tag: '@a11y' }, async ({ page }) => {
    await setup(page, { balance: (params) => ({ ...balance(params), missingRates: ['USD'] }) })
    await openReports(page, '/reports/balance')
    await balanceReady(page)
    await expect(page.getByText(t.reports.balance.missingRates(['USD']))).toBeVisible()
    await expectNoAxeViolations(page)
  })
})
