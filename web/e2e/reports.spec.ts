import { expect, test, type Page } from '@playwright/test'

import { ru as t } from '../src/shared/i18n/ru.ts'
import {
  emptyCategoryReport,
  enlargeFont,
  existingAccount,
  expectNoAxeViolations,
  fontsReady,
  horizontalOverflow,
  meFixture,
  mockReportsApi,
  mockSignedIn,
  problem,
  type Category,
  type CategoryReportBody,
} from './support.ts'

// Экран «Отчёты», вкладка «По категориям»: вывод текстом со сравнением, кольцо, таблица
// с подкатегориями, переход в ленту, фильтры в адресе, состояния. Часы зафиксированы:
// «текущий месяц» — ноябрь 2026, сравнение — с 1–24 октября.

const NOW = new Date('2026-11-24T12:00:00+03:00')

const card = existingAccount
const cash = { ...existingAccount, id: '01a1faf8-0000-7000-8000-0000000000a2', name: 'Наличные' }
const accounts = [card, cash]

function category(id: number, name: string, extra: Partial<Category> = {}): Category {
  return {
    id: `01a1faf8-0000-7000-8000-0000000000${String(id).padStart(2, '0')}`,
    kind: 'expense',
    parentId: null,
    name,
    sortOrder: id,
    archivedAt: null,
    ...extra,
  }
}
const food = category(10, 'Продукты')
const dairy = category(11, 'Молочное', { parentId: food.id })
const meat = category(12, 'Мясо', { parentId: food.id })
const cafe = category(13, 'Кафе и рестораны')
const transport = category(14, 'Транспорт')
const home = category(15, 'Дом')
const health = category(16, 'Здоровье')
const gifts = category(17, 'Подарки родственникам, друзьям и коллегам на праздники')
const clothes = category(18, 'Одежда')
const kids = category(19, 'Дети')
const pets = category(20, 'Питомцы', { archivedAt: '2026-11-01T00:00:00Z' })
const salary = category(21, 'Зарплата', { kind: 'income' })
const categories = [
  food,
  dairy,
  meat,
  cafe,
  transport,
  home,
  health,
  gifts,
  clothes,
  kids,
  pets,
  salary,
]

/** Ноябрь: 9 категорий верхнего уровня — в кольце 7 крупнейших и «Прочее». */
const november: CategoryReportBody = {
  currency: 'RUB',
  total: 8_430_000,
  items: [
    { categoryId: dairy.id, amount: 1_250_000 },
    { categoryId: cafe.id, amount: 1_800_000 },
    { categoryId: meat.id, amount: 1_100_000 },
    { categoryId: food.id, amount: 400_000 },
    { categoryId: transport.id, amount: 950_000 },
    { categoryId: home.id, amount: 900_000 },
    { categoryId: health.id, amount: 700_000 },
    { categoryId: gifts.id, amount: 600_000 },
    { categoryId: clothes.id, amount: 450_000 },
    { categoryId: kids.id, amount: 250_000 },
    { categoryId: pets.id, amount: 30_000 },
  ],
  missingRates: [],
}

/** 1–24 октября — для сравнения: ноябрь на 12 % меньше. */
const octoberToDate: CategoryReportBody = { ...emptyCategoryReport, total: 9_580_000 }

const income: CategoryReportBody = {
  currency: 'RUB',
  total: 15_000_000,
  items: [{ categoryId: salary.id, amount: 15_000_000 }],
  missingRates: [],
}

function respond(params: URLSearchParams): CategoryReportBody {
  if (params.get('kind') === 'income') return income
  if (params.get('from') === '2026-10-01' && params.get('to') === '2026-10-24') {
    return octoberToDate
  }
  if (params.get('from') === '2026-11-01') return november
  return emptyCategoryReport
}

async function setup(page: Page, options: { respond?: typeof respond; memberCount?: number } = {}) {
  await page.clock.setFixedTime(NOW)
  const me = meFixture()
  me.family.memberCount = options.memberCount ?? 1
  await mockSignedIn(page, me)
  return mockReportsApi(page, { respond: options.respond ?? respond, accounts, categories })
}

async function openReports(page: Page, path = '/reports/categories') {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1, name: t.nav.reports })).toBeVisible()
  await fontsReady(page)
}

const headline = (page: Page) => page.locator('main').getByRole('heading', { level: 2 }).first()

/** Текст с суммами: Intl ставит неразрывные пробелы, в ожидании — обычные. */
const spaced = (text: string) =>
  new RegExp(`^${text.replace(/[$+.*?()[\]\\]/g, '\\$&').replace(/ /g, '\\s*')}$`)

async function reportReady(page: Page) {
  await expect(headline(page)).toHaveText(spaced('В ноябре потрачено 84 300 ₽'))
  await expect(page.getByText(spaced('На 12 % меньше, чем за 1–24 октября'))).toBeVisible()
}

test.describe('по категориям', () => {
  test('скриншот: вывод, кольцо, таблица', { tag: '@visual' }, async ({ page }) => {
    await setup(page)
    await openReports(page)
    await reportReady(page)
    await expect(page).toHaveScreenshot('reports-categories.png', { fullPage: true })
  })

  test('скриншот при шрифте 200 %', { tag: '@visual' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Крупный шрифт важен на узком экране')
    await setup(page)
    await openReports(page)
    await reportReady(page)
    await enlargeFont(page)
    expect(await horizontalOverflow(page)).toBe(0)
    await expect(page).toHaveScreenshot('reports-categories-font-200.png', { fullPage: true })
  })

  test('доступность, таблица, подкатегории', { tag: '@a11y' }, async ({ page }) => {
    await setup(page)
    await openReports(page)
    await reportReady(page)
    await expectNoAxeViolations(page)

    // Таблица — все категории, «Прочее» в ней не схлопывается.
    const table = page.getByRole('table', { name: 'Расходы по категориям, Ноябрь 2026' })
    const names = table.locator('tbody th')
    await expect(names).toHaveCount(9)
    await expect(names.first()).toHaveText('Продукты')
    await expect(table.getByText(`${pets.name} (в архиве)`)).toBeVisible()
    // Продукты: 4 000 ₽ своих + 23 500 ₽ подкатегорий = 27 500 ₽, 33 % от 84 300 ₽.
    await expect(table.locator('tbody tr').first().locator('td')).toHaveText(spaced('27 500 ₽33 %'))
    await expect(table.locator('tfoot td')).toHaveText(spaced('84 300 ₽100 %'))

    // Подкатегории раскрываются кнопкой; собственные операции — «Без подкатегории».
    const toggle = page.getByRole('button', { name: t.reports.table.expand('Продукты') })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(names).toHaveCount(12)
    await expect(names.nth(1)).toHaveText('Молочное')
    await expect(names.nth(3)).toHaveText(t.reports.table.own)
    // У строки «Без подкатегории» нет ссылки: лента не покажет родителя без подкатегорий.
    await expect(names.nth(3).getByRole('link')).toHaveCount(0)
    await expectNoAxeViolations(page)
    expect(await horizontalOverflow(page)).toBe(0)
    await toggle.click()
    await expect(names).toHaveCount(9)
  })

  test('строка таблицы ведёт в ленту с теми же фильтрами', { tag: '@a11y' }, async ({ page }) => {
    await setup(page, { memberCount: 2 })
    const me = meFixture().user.id
    await openReports(
      page,
      `/reports/categories?accountId=${cash.id}&authorId=${me}&from=2026-11-01&to=2026-11-30`,
    )
    await reportReady(page)
    // С клавиатуры: ссылка — название категории.
    await page.getByRole('link', { name: 'Кафе и рестораны' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1, name: t.nav.transactions })).toBeVisible()
    const url = new URL(page.url())
    expect(url.pathname).toBe('/transactions')
    expect([...url.searchParams]).toEqual([
      ['from', '2026-11-01'],
      ['to', '2026-11-30'],
      ['kind', 'expense'],
      ['accountId', cash.id],
      ['categoryId', cafe.id],
      ['authorId', me],
    ])
    // Лента показывает автора чипом — фильтр не спрятан.
    await expect(
      page.getByRole('button', { name: t.feed.filters.remove(t.feed.filters.mine) }),
    ).toBeVisible()
  })

  test('кольцо: мышь — клик в ленту, палец — сначала сумма', async ({ page, isMobile }) => {
    await setup(page)
    await openReports(page)
    await reportReady(page)
    // Первый сегмент — «Продукты», 33 %: от 0° (справа) против часовой стрелки. Точка
    // на середине дуги (60°) и середине толщины кольца (радиус 104 − 18 = 86 px): центр
    // рамки сектора попадал бы в дырку кольца.
    const surface = page.locator('svg.recharts-surface')
    const position = { x: 104 + 86 * Math.cos(Math.PI / 3), y: 104 - 86 * Math.sin(Math.PI / 3) }
    const firstSector = {
      tap: () => surface.tap({ position }),
      hover: () => surface.hover({ position }),
      click: () => surface.click({ position }),
    }
    if (isMobile) {
      await firstSector.tap()
      await expect(page.getByText(t.reports.chart.tapAgain)).toBeVisible()
      await expect(page).toHaveURL(/\/reports\/categories$/)
      await firstSector.tap()
    } else {
      await firstSector.hover()
      // Наведение — название и сумма под кольцом.
      await expect(page.getByText(spaced('27 500 ₽ · 33 %'))).toBeVisible()
      await firstSector.click()
    }
    await expect(page).toHaveURL(new RegExp(`/transactions\\?.*categoryId=${food.id}`))
  })

  test('вид «Доходы» и вкладки сохраняют фильтры', { tag: '@a11y' }, async ({ page }) => {
    const api = await setup(page)
    await openReports(page, `/reports?accountId=${card.id}`)
    // /reports — перенаправление на первую вкладку с теми же параметрами.
    await expect(page).toHaveURL(new RegExp(`/reports/categories\\?accountId=${card.id}$`))
    await page.locator('label', { hasText: t.reports.kind.income }).click()
    await expect(headline(page)).toHaveText(spaced('В ноябре получено 150 000 ₽'))
    await expect(page).toHaveURL(/kind=income/)
    const last = api.requests.at(-1)!
    expect(last.get('kind')).toBe('income')
    expect(last.getAll('accountId')).toEqual([card.id])
    // Чип счёта виден.
    await expect(page.getByRole('button', { name: t.feed.filters.remove('Карта') })).toBeVisible()

    // Другая вкладка — ссылка с теми же параметрами: счёт переходит в отчёт по месяцам.
    const before = api.requests.length
    await page.getByRole('link', { name: t.reports.tabs.monthly }).click()
    await expect(page).toHaveURL(new RegExp(`/reports/monthly\\?kind=income&accountId=${card.id}$`))
    await expect(page.getByRole('link', { name: t.reports.tabs.monthly })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect.poll(() => api.monthlyRequests.at(-1)?.getAll('accountId')).toEqual([card.id])
    await expectNoAxeViolations(page)
    expect(api.requests.length).toBe(before)
  })

  test(
    'пока грузятся доходы, прежний отчёт приглушён и не выдаёт себя за новый',
    { tag: '@a11y' },
    async ({ page }) => {
      await setup(page)
      // Ответ по доходам — только по сигналу: виден промежуточный кадр.
      let release!: () => void
      const released = new Promise<void>((resolve) => (release = resolve))
      await page.route(
        (url) =>
          url.pathname.endsWith('/reports/categories') && url.searchParams.get('kind') === 'income',
        async (route) => {
          await released
          await route.fallback()
        },
      )
      await openReports(page)
      await reportReady(page)
      await page.locator('label', { hasText: t.reports.kind.income }).click()
      await expect(page).toHaveURL(/kind=income/)

      // Прежние суммы — с прежним заголовком («потрачено»), блок приглушён и инертен:
      // ссылки строк по прежним данным не работают, сравнения нет (место под него занято).
      const stale = page.locator('[data-stale]')
      await expect(stale).toBeVisible()
      await expect(stale).toHaveAttribute('inert', '')
      await expect(headline(page)).toHaveText(spaced('В ноябре потрачено 84 300 ₽'))
      await expect(page.getByText(/меньше, чем/)).toHaveCount(0)
      await expect(page.locator('main [aria-busy="true"]')).toHaveCount(1)
      await expectNoAxeViolations(page)

      release()
      await expect(headline(page)).toHaveText(spaced('В ноябре получено 150 000 ₽'))
      await expect(stale).toHaveCount(0)
      // Ссылка строки — с новым видом и категорией нового отчёта.
      await expect(page.getByRole('link', { name: 'Зарплата' })).toHaveAttribute(
        'href',
        new RegExp(`kind=income&categoryId=${salary.id}`),
      )
    },
  )

  test('пусто за прошлый месяц — без «Сбросить фильтры»', async ({ page }) => {
    await setup(page, { respond: () => emptyCategoryReport })
    await openReports(page, '/reports/categories?from=2026-10-01&to=2026-10-31')
    await expect(page.getByRole('heading', { name: t.reports.empty.expense })).toBeVisible()
    await expect(page.getByText(t.reports.empty.description)).toBeVisible()
    await expect(page.getByRole('button', { name: t.reports.empty.resetFilters })).toHaveCount(0)
  })

  test('прошлый месяц — сравнение с целым месяцем', async ({ page }) => {
    await setup(page, {
      respond: (params) =>
        params.get('from') === '2026-10-01'
          ? {
              ...emptyCategoryReport,
              total: 5_000_000,
              items: [{ categoryId: cafe.id, amount: 5_000_000 }],
            }
          : { ...emptyCategoryReport, total: 4_000_000 },
    })
    await openReports(page)
    await page.getByLabel(t.feed.filters.period).selectOption('lastMonth')
    await expect(headline(page)).toHaveText(spaced('В октябре потрачено 50 000 ₽'))
    await expect(page.getByText(spaced('На 25 % больше, чем в сентябре'))).toBeVisible()
    await expect(page).toHaveURL(/from=2026-10-01&to=2026-10-31/)
  })
})

test.describe('состояния', () => {
  test('пусто', { tag: ['@visual', '@a11y'] }, async ({ page }) => {
    await setup(page, { respond: () => emptyCategoryReport })
    await openReports(page)
    await expect(page.getByRole('heading', { name: t.reports.empty.expense })).toBeVisible()
    await expect(page).toHaveScreenshot('reports-empty.png', { fullPage: true })
    await expectNoAxeViolations(page)
    await page.locator('main').getByRole('button', { name: t.nav.addTransaction }).click()
    await expect(page.getByRole('dialog', { name: t.quickAdd.title })).toBeVisible()
  })

  test('ошибка загрузки и «Повторить»', { tag: ['@visual', '@a11y'] }, async ({ page }) => {
    await setup(page)
    // Сеть и 5xx клиент повторяет один раз — для экрана ошибки нужно два отказа. Отказывает
    // только отчёт за ноябрь: сравнение с октябрём уходит параллельно.
    let failures = 2
    await page.route(
      (url) =>
        url.pathname.endsWith('/reports/categories') && url.searchParams.get('to') === '2026-11-30',
      (route) => (failures-- > 0 ? problem(route, 500, 'internal') : route.fallback()),
    )
    await openReports(page)
    await expect(page.getByRole('heading', { name: t.reports.loadError })).toBeVisible()
    await expect(page.getByText(t.errors.server)).toBeVisible()
    await expect(page).toHaveScreenshot('reports-error.png', { fullPage: true })
    await expectNoAxeViolations(page)
    await page.getByRole('button', { name: t.errors.retry }).click()
    await reportReady(page)
  })

  test('нет курса валюты — предупреждение', { tag: ['@visual', '@a11y'] }, async ({ page }) => {
    await setup(page, {
      respond: (params) =>
        params.get('from') === '2026-11-01'
          ? { ...november, missingRates: ['USD'] }
          : respond(params),
    })
    await openReports(page)
    await reportReady(page)
    await expect(page.getByText(t.reports.missingRates(['USD']))).toBeVisible()
    await expect(page).toHaveScreenshot('reports-missing-rates.png', { fullPage: true })
    await expectNoAxeViolations(page)
  })

  test('огромные суммы при шрифте 200 %', { tag: '@visual' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Крупный шрифт важен на узком экране')
    await setup(page, {
      respond: () => ({
        currency: 'RUB',
        total: 999_999_999_999_999,
        items: [
          { categoryId: gifts.id, amount: 899_999_999_999_999 },
          { categoryId: cafe.id, amount: 100_000_000_000_000 },
        ],
        missingRates: ['USD', 'EUR'],
      }),
    })
    await openReports(page)
    await expect(headline(page)).toContainText('потрачено')
    await enlargeFont(page)
    expect(await horizontalOverflow(page)).toBe(0)
    await expect(page).toHaveScreenshot('reports-huge-font-200.png', { fullPage: true })
  })
})
