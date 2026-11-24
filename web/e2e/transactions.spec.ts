import { expect, test, type Locator, type Page, type Route } from '@playwright/test'

import { ru as t } from '../src/shared/i18n/ru.ts'
import {
  API,
  enlargeFont,
  existingAccount,
  expectNoAxeViolations,
  fontsReady,
  horizontalOverflow,
  mockSignedIn,
  mockFeedApi,
  problem,
  transaction,
  type Category,
  type Transaction,
  type FeedMock,
} from './support.ts'

// Экран «Операции»: лента по дням с итогами, фильтры в адресе, итоги выборки, подгрузка
// страниц, удаление с отменой. API подменяется через page.route (mockFeedApi),
// часы зафиксированы: «Сегодня» и «Вчера» в кадре не меняются день ото дня.

const NOW = new Date('2026-11-23T12:00:00+03:00')

const card = existingAccount
const cash = { ...existingAccount, id: '01a1faf8-0000-7000-8000-0000000000a2', name: 'Наличные' }
const usd = {
  ...existingAccount,
  id: '01a1faf8-0000-7000-8000-0000000000a3',
  name: 'Доллары',
  currency: 'USD',
}
const oldCard = {
  ...existingAccount,
  id: '01a1faf8-0000-7000-8000-0000000000a4',
  name: 'Старая карта',
  archivedAt: '2026-01-01T00:00:00Z',
}
const accounts = [card, cash, usd, oldCard]

function category(id: number, name: string, extra: Partial<Category> = {}): Category {
  return {
    id: `01a1faf8-0000-7000-8000-0000000000c${id}`,
    kind: 'expense',
    parentId: null,
    name,
    sortOrder: id,
    archivedAt: null,
    ...extra,
  }
}
const food = category(1, 'Продукты')
const dairy = category(2, 'Молочное', { parentId: food.id })
const cafe = category(3, 'Кафе')
const subscriptions = category(4, 'Подписки')
const gifts = category(5, 'Подарки родственникам, друзьям и коллегам на праздники')
const salary = category(6, 'Зарплата', { kind: 'income' })
const categories = [food, dairy, cafe, subscriptions, gifts, salary]

/** Лента всех видов и двух валют, за сегодня, вчера, неделю назад и прошлый год. */
function fixture(): Transaction[] {
  return [
    transaction({
      date: '2025-11-16',
      accountId: oldCard.id,
      categoryId: food.id,
      amount: 30_000,
    }),
    transaction({
      date: '2026-11-17',
      categoryId: gifts.id,
      amount: 9_999_999_999_999,
      comment: 'Торт, цветы и открытка для бабушки — заказ с доставкой на субботу к обеду',
    }),
    transaction({ date: '2026-11-17', kind: 'adjustment', amount: -100_000, editable: false }),
    transaction({
      date: '2026-11-17',
      kind: 'transfer',
      accountId: null,
      amount: null,
      currency: null,
      toAccountId: card.id,
      toAmount: 1_000_000,
      toCurrency: 'RUB',
      counterparty: { id: 'u2', name: 'Иван' },
      editable: false,
    }),
    transaction({
      date: '2026-11-22',
      kind: 'adjustment',
      accountId: cash.id,
      amount: 25_050,
      editable: false,
    }),
    transaction({
      date: '2026-11-22',
      accountId: usd.id,
      currency: 'USD',
      categoryId: subscriptions.id,
      amount: 1_250,
      comment: 'Музыка',
    }),
    transaction({
      date: '2026-11-22',
      kind: 'transfer',
      amount: 925_000,
      toAccountId: usd.id,
      toAmount: 10_000,
      toCurrency: 'USD',
    }),
    transaction({ date: '2026-11-22', kind: 'income', categoryId: salary.id, amount: 15_000_000 }),
    transaction({
      date: '2026-11-23',
      kind: 'transfer',
      amount: 500_000,
      toAccountId: cash.id,
      toAmount: 500_000,
      toCurrency: 'RUB',
    }),
    transaction({
      date: '2026-11-23',
      accountId: cash.id,
      categoryId: cafe.id,
      amount: 45_000,
      comment: 'Кофе',
    }),
    transaction({
      date: '2026-11-23',
      categoryId: dairy.id,
      amount: 129_000,
      comment: 'Сыр и йогурт',
    }),
  ]
}

async function setup(page: Page, transactions: Transaction[] = fixture(), pageSize?: number) {
  await page.clock.setFixedTime(NOW)
  await mockSignedIn(page)
  return mockFeedApi(page, { transactions, accounts, categories, pageSize })
}

async function openFeed(page: Page, query = '') {
  await page.goto(`/transactions${query}`)
  await expect(page.getByRole('heading', { level: 1, name: t.nav.transactions })).toBeVisible()
  await fontsReady(page)
}

/** Ждём ленту: заголовок первого дня на месте. */
async function feedReady(page: Page, firstDay: string = t.dates.today) {
  await expect(page.getByRole('heading', { level: 2, name: firstDay })).toBeVisible()
}

/** Кнопка строки (открыть операцию) — по тексту внутри строки. */
const rowButton = (page: Page, text: string) =>
  page
    .locator('[data-transaction-row]', { has: page.getByText(text, { exact: true }) })
    .locator('[data-transaction-open]')

const menuOf = (page: Page, title: string) =>
  page.getByRole('button', { name: t.feed.row.actions(title) })

/** Тост — по тексту: у Mantine нет роли у уведомления. */
const toast = (page: Page, text: string | RegExp) =>
  page.locator('.mantine-Notification-root').filter({ hasText: text })

/** Текст с суммами: Intl ставит неразрывные пробелы, в ожидании — обычные. */
const money = (text: string) =>
  new RegExp(`^${text.replace(/[$+.*?()[\]\\]/g, '\\$&').replace(/ /g, '\\s*')}$`)

/** Заголовок дня с итогом. */
const dayHeader = (page: Page, day: string) =>
  page.getByRole('heading', { level: 2, name: day, exact: true }).locator('..')

/**
 * Следующие `times` запросов с ключом `key` — ответ `handler` (запросы с ошибкой сети
 * и 5xx клиент повторяет один раз, поэтому для экрана ошибки нужно два отказа).
 */
function failTimes(
  api: FeedMock,
  key: string,
  times: number,
  handler: (route: Route) => Promise<void>,
) {
  api.failNext.set(key, (route) => {
    if (times > 1) failTimes(api, key, times - 1, handler)
    return handler(route)
  })
}

const summary = (page: Page) =>
  page.getByRole('region', { name: new RegExp(`^${t.feed.summary.title}`) })

test.describe('лента', () => {
  test('скриншот: все виды операций и две валюты', { tag: '@visual' }, async ({ page }) => {
    await setup(page)
    await openFeed(page)
    await feedReady(page)
    await expect(page).toHaveScreenshot('feed.png', { fullPage: true })
  })

  test('скриншот при шрифте 200 %', { tag: '@visual' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Крупный шрифт важен на узком экране')
    await setup(page)
    await openFeed(page)
    await feedReady(page)
    await enlargeFont(page)
    expect(await horizontalOverflow(page)).toBe(0)
    await expect(page).toHaveScreenshot('feed-font-200.png', { fullPage: true })
  })

  test('доступность, группы, итоги', { tag: '@a11y' }, async ({ page }) => {
    await setup(page)
    await openFeed(page)
    await feedReady(page)
    // Группы по дням: «Сегодня», «Вчера», «Вт, 17 ноября», прошлый год — с годом.
    const days = await page
      .locator('main')
      .getByRole('heading', { level: 2 })
      .filter({ hasNotText: t.feed.summary.title })
      .allTextContents()
    expect(days).toEqual(['Сегодня', 'Вчера', 'Вт, 17 ноября', '16 ноября 2025'])

    // Итог дня: расход «−» по валютам, доход «+»; переводы и корректировки не входят.
    const yesterday = page.getByRole('heading', { level: 2, name: t.dates.yesterday }).locator('..')
    await expect(yesterday).toHaveText(money('Вчера Итог дня: +150 000 ₽ −12,50 $'))

    // Итоги выборки: по каждой валюте расходы, доходы, разница.
    const totals = summary(page).locator('dl')
    await expect(totals).toHaveText([
      money('Расходы −100 000 002 039,99 ₽ Доходы +150 000 ₽ Разница −99 999 852 039,99 ₽'),
      // Нули не показываются, разница без пары — тоже.
      money('Расходы −12,50 $'),
    ])
    await expect(page.getByText('Пополнение: Иван')).toBeVisible()
    await expect(page.getByText('Карта → Доллары')).toBeVisible()

    await expectNoAxeViolations(page)

    // Перевод со скрытой стороной не удалить и не дублировать — в меню только «Изменить»
    // (форма объяснит, почему нельзя).
    await menuOf(page, 'Пополнение: Иван').click()
    await expect(page.getByRole('menuitem')).toHaveText([t.feed.actions.edit])
    await page.keyboard.press('Escape')
    // Корректировку можно удалить, но не дублировать.
    await menuOf(page, t.feed.row.adjustment).first().click()
    await expect(page.getByRole('menuitem')).toHaveText([
      t.feed.actions.edit,
      t.feed.actions.delete,
    ])
    await page.keyboard.press('Escape')
    expect(await horizontalOverflow(page)).toBe(0)
  })

  test('автор — только в семье из нескольких человек', { tag: '@a11y' }, async ({ page }) => {
    await page.clock.setFixedTime(NOW)
    const me = {
      user: {
        id: '01a1faf8-0000-7000-8000-000000000001',
        email: 'anna@example.com',
        name: 'Анна',
        timezone: 'Europe/Moscow',
        emailVerified: true,
      },
      family: {
        id: '01a1faf8-0000-7000-8000-000000000002',
        name: 'Семья',
        role: 'owner' as const,
        memberCount: 2,
      },
    }
    await mockSignedIn(page, me)
    await mockFeedApi(page, { transactions: fixture(), accounts, categories })
    await openFeed(page)
    await feedReady(page)
    await expect(page.getByText('Анна · Сыр и йогурт')).toBeVisible()
  })
})

test.describe('состояния', () => {
  test('пусто: нет ни одной операции', { tag: ['@visual', '@a11y'] }, async ({ page }) => {
    await setup(page, [])
    await openFeed(page)
    await expect(page.getByRole('heading', { name: t.feed.emptyTitle })).toBeVisible()
    // Фильтров и итогов нет — фильтровать нечего.
    await expect(page.getByLabel(t.feed.filters.search)).toHaveCount(0)
    await expect(page).toHaveScreenshot('feed-empty.png', { fullPage: true })
    await expectNoAxeViolations(page)
    // «Добавить операцию» открывает быстрый ввод.
    await page.locator('main').getByRole('button', { name: t.nav.addTransaction }).click()
    await expect(page.getByRole('dialog', { name: t.quickAdd.title })).toBeVisible()
  })

  test('пусто по фильтрам', { tag: ['@visual', '@a11y'] }, async ({ page }) => {
    await setup(page)
    await openFeed(page, '?q=ничего')
    await expect(page.getByRole('heading', { name: t.feed.nothingFoundTitle })).toBeVisible()
    await expect(page).toHaveScreenshot('feed-nothing-found.png', { fullPage: true })
    await expectNoAxeViolations(page)
    await page.getByRole('button', { name: t.feed.resetFilters }).click()
    await feedReady(page)
    await expect(page).toHaveURL(/\/transactions$/)
  })

  test('ошибка загрузки и «Повторить»', { tag: ['@visual', '@a11y'] }, async ({ page }) => {
    const api = await setup(page)
    failTimes(api, 'GET /transactions', 2, (route) => problem(route, 500, 'internal'))
    await openFeed(page)
    await expect(page.getByRole('heading', { name: t.feed.loadError })).toBeVisible()
    await expect(page.getByText(t.errors.server)).toBeVisible()
    await expect(page).toHaveScreenshot('feed-error.png', { fullPage: true })
    await expectNoAxeViolations(page)
    await page.getByRole('button', { name: t.errors.retry }).click()
    await feedReady(page)
  })
})

test.describe('фильтры', () => {
  test('фильтр из адреса: запрос, чипы, итоги по фильтрам', { tag: '@a11y' }, async ({ page }) => {
    const api = await setup(page)
    await openFeed(page, `?kind=expense&categoryId=${food.id}&from=2026-11-01&to=2026-11-30`)
    await feedReady(page)
    // Запрос — с теми же параметрами.
    const params = api.listRequests.at(-1)!
    expect(params.getAll('kind')).toEqual(['expense'])
    expect(params.getAll('categoryId')).toEqual([food.id])
    expect(params.get('from')).toBe('2026-11-01')
    // Категория верхнего уровня включает подкатегории: «Молочное» в ленте.
    await expect(page.getByText('Сыр и йогурт')).toBeVisible()
    await expect(page.getByText('Кофе')).toHaveCount(0)
    await expect(summary(page)).toHaveAccessibleName(t.feed.summary.filteredTitle)

    const chips = page.getByRole('list', { name: t.feed.filters.activeLabel })
    await expect(chips.getByRole('button')).toHaveText([
      t.feed.filters.periods.thisMonth,
      t.feed.filters.kinds.expense,
      food.name,
    ])
    await expectNoAxeViolations(page)

    // Крестик на чипе снимает фильтр, фокус — на соседний чип.
    await chips
      .getByRole('button', { name: t.feed.filters.remove(t.feed.filters.kinds.expense) })
      .click()
    await expect(page).toHaveURL(/\/transactions\?from=2026-11-01&to=2026-11-30&categoryId=/)
    await expect(
      chips.getByRole('button', { name: t.feed.filters.remove(food.name) }),
    ).toBeFocused()

    // «Сбросить всё» — лента без фильтров, фокус — в поиск.
    await page.getByRole('button', { name: t.feed.resetAll }).click()
    await expect(page).toHaveURL(/\/transactions$/)
    await expect(page.getByLabel(t.feed.filters.search)).toBeFocused()
    await expect(page.getByText('Кофе')).toBeVisible()
  })

  test('поиск — с задержкой, в адресе', { tag: '@a11y' }, async ({ page }) => {
    const api = await setup(page)
    await openFeed(page)
    await feedReady(page)
    const before = api.listRequests.length
    await page.getByLabel(t.feed.filters.search).pressSequentially('кофе')
    await expect(page).toHaveURL(/q=%D0%BA%D0%BE%D1%84%D0%B5/)
    await expect(page.getByText('Сыр и йогурт')).toHaveCount(0)
    // Один запрос на всё слово, а не на каждую букву.
    expect(api.listRequests.length - before).toBe(1)
    expect(api.listRequests.at(-1)!.get('q')).toBe('кофе')
  })

  test('панель фильтров на mobile', { tag: ['@visual', '@a11y'] }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'На desktop фильтры — панелью над лентой')
    await setup(page)
    await openFeed(page, '?kind=income')
    await feedReady(page, t.dates.yesterday)
    await page.getByRole('button', { name: t.feed.filters.openWithCount(1) }).click()
    const dialog = page.getByRole('dialog', { name: t.feed.filters.title })
    await expect(dialog).toBeVisible()
    await expect(page).toHaveScreenshot('feed-filters-sheet.png')
    await expectNoAxeViolations(page)

    // Период «Этот месяц» — сразу в адресе.
    await dialog.getByLabel(t.feed.filters.period).selectOption('thisMonth')
    await expect(page).toHaveURL(/from=2026-11-01&to=2026-11-30/)
    // «Свой период» — два поля даты.
    await dialog.getByLabel(t.feed.filters.period).selectOption('custom')
    await dialog.getByLabel(t.feed.filters.from).fill('2026-11-20')
    await expect(page).toHaveURL(/from=2026-11-20&to=2026-11-30/)
    await dialog.getByRole('button', { name: t.feed.filters.apply }).click()
    await expect(dialog).toBeHidden()
    await expect(
      page.getByRole('button', { name: t.feed.filters.remove('20–30 ноября') }),
    ).toBeVisible()
  })

  test(
    'поле поиска следует за адресом при переходе по меню',
    { tag: '@a11y' },
    async ({ page }) => {
      await setup(page)
      await openFeed(page)
      await feedReady(page)
      const field = page.getByLabel(t.feed.filters.search)
      await field.pressSequentially('кофе')
      await expect(page).toHaveURL(/q=/)
      await page
        .getByRole('navigation', { name: t.nav.label })
        .getByRole('link', { name: t.nav.transactions })
        .click()
      await expect(page).toHaveURL(/\/transactions$/)
      await expect(field).toHaveValue('')
      await expect(page.getByText('Сыр и йогурт')).toBeVisible()
    },
  )

  test('свой период набирается с клавиатуры', { tag: '@a11y' }, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Поля те же, на desktop — без окна')
    const api = await setup(page)
    await openFeed(page, '?from=2026-11-01&to=2026-11-30')
    await feedReady(page)
    const panel = page.getByRole('region', { name: t.feed.filters.label })
    await panel.getByLabel(t.feed.filters.period).selectOption('custom')
    const end = panel.getByLabel(t.feed.filters.to)
    // Фокус на первом сегменте; дальше — цифрами, как с клавиатуры. 11.11 — чтобы не зависеть
    // от порядка «день/месяц» в поле (он берётся из языка системы, а не страницы).
    await end.focus()
    await end.pressSequentially('11112026')
    // Пока набирается — адрес прежний: промежуточные даты (`2026-01-11`, `0002-11-11`…)
    // не уходят ни в адрес, ни в API. Enter (или уход из поля) — применить.
    await expect(end).toHaveValue('2026-11-11')
    await expect(page).toHaveURL(/from=2026-11-01&to=2026-11-30/)
    await end.press('Enter')
    await expect(page).toHaveURL(/from=2026-11-01&to=2026-11-11/)
    await expect(end).toHaveValue('2026-11-11')
    await expect(panel.getByLabel(t.feed.filters.from)).toHaveValue('2026-11-01')
    await expect.poll(() => api.listRequests.length).toBe(2)
    expect(api.listRequests.map((p) => p.get('to'))).toEqual(['2026-11-30', '2026-11-11'])
    await expect(page.getByText('Сыр и йогурт')).toHaveCount(0)
  })

  test('панель фильтров на desktop', { tag: '@a11y' }, async ({ page, isMobile }) => {
    test.skip(isMobile, 'На mobile фильтры — в нижней панели')
    const api = await setup(page)
    await openFeed(page)
    await feedReady(page)
    const panel = page.getByRole('region', { name: t.feed.filters.label })
    await panel.getByText(t.feed.filters.kinds.transfer).click()
    await expect(page).toHaveURL(/kind=transfer/)
    await panel.getByRole('combobox', { name: t.feed.filters.accounts }).click()
    await page.getByRole('option', { name: 'Наличные' }).click()
    await expect(page).toHaveURL(new RegExp(`accountId=${cash.id}`))
    await expect(page.getByText('Карта → Наличные')).toBeVisible()
    await expect(page.getByText('Карта → Доллары')).toHaveCount(0)
    expect(api.listRequests.at(-1)!.getAll('accountId')).toEqual([cash.id])
  })
})

/** 70 операций по одной в день: первая страница — 50, вторая — 20. */
function manyTransactions(): Transaction[] {
  return Array.from({ length: 70 }, (_, i) => {
    const date = new Date(Date.UTC(2026, 10, 23 - i)).toISOString().slice(0, 10)
    return transaction({ date, categoryId: food.id, comment: `Покупка ${i + 1}` })
  })
}

test.describe('подгрузка', () => {
  test('при прокрутке до конца — следующая страница', { tag: '@a11y' }, async ({ page }) => {
    const api = await setup(page, manyTransactions())
    await openFeed(page)
    await feedReady(page)
    await expect(page.getByText('Покупка 50', { exact: true })).toBeAttached()
    await expect(page.getByText('Покупка 51', { exact: true })).toHaveCount(0)
    await page.getByText('Покупка 50', { exact: true }).scrollIntoViewIfNeeded()
    await expect(page.getByText('Покупка 70', { exact: true })).toBeAttached()
    // Курсор — позиция последней строки первой страницы («дата|id»), как в API.
    const cursors = api.listRequests.map((p) => p.get('cursor'))
    expect(cursors).toHaveLength(2)
    expect(cursors[0]).toBeNull()
    expect(Buffer.from(cursors[1]!, 'base64url').toString()).toMatch(/^2026-10-05\|/)
    // Диктору — сколько подгрузилось.
    await expect(page.getByRole('status').filter({ hasText: /Загружено ещё/ })).toHaveText(
      t.feed.loadedMore('20 операций'),
    )
    // Последняя страница — «Показать ещё» больше нет.
    await expect(page.getByRole('button', { name: t.feed.showMore })).toHaveCount(0)
  })

  test(
    'ошибка следующей страницы — «Повторить», загруженное на месте',
    { tag: '@a11y' },
    async ({ page }) => {
      const api = await setup(page, manyTransactions())
      await openFeed(page)
      await feedReady(page)
      // Следующий запрос (вторая страница) — ошибка сети.
      failTimes(api, 'GET /transactions', 2, (route) => route.abort())
      await page.getByRole('button', { name: t.feed.showMore }).scrollIntoViewIfNeeded()
      await expect(page.getByText(t.feed.nextPageError)).toBeVisible()
      await expect(page.getByText('Покупка 1', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: t.errors.retry }).click()
      await expect(page.getByText('Покупка 70', { exact: true })).toBeAttached()
      await expect(page.getByText(t.feed.nextPageError)).toHaveCount(0)
    },
  )
})

test.describe('удаление и подгрузка', () => {
  test(
    'удалили строку первой страницы — вторая без пропусков и дублей',
    { tag: '@a11y' },
    async ({ page }) => {
      const api = await setup(page, manyTransactions())
      await openFeed(page)
      await feedReady(page)
      const row = page.locator('[data-transaction-row]', {
        has: page.getByText('Покупка 2', { exact: true }),
      })
      await row.getByRole('button', { name: t.feed.row.actions(food.name) }).click()
      await page.getByRole('menuitem', { name: t.feed.actions.delete }).click()
      await expect.poll(() => api.received).toContain('DELETE /transactions/:id')
      // Прокрутка к концу — подгрузка второй страницы (кнопку на mobile закрывает тост).
      await page.getByText('Покупка 50', { exact: true }).scrollIntoViewIfNeeded()
      await expect(page.getByText('Покупка 70', { exact: true })).toBeAttached()
      const comments = await page
        .locator('[data-transaction-row]')
        .getByText(/^Покупка \d+$/)
        .allTextContents()
      expect(comments).toHaveLength(69)
      expect(new Set(comments).size).toBe(69)
      expect(comments).toContain('Покупка 51')
      expect(comments).not.toContain('Покупка 2')
    },
  )
})

test.describe('удаление', () => {
  test('сразу, с «Отменить»; фокус — на соседнюю строку', { tag: '@a11y' }, async ({ page }) => {
    const api = await setup(page)
    await openFeed(page)
    await feedReady(page)
    const title = `${food.name} › ${dairy.name}`
    await menuOf(page, title).click()
    await page.getByRole('menuitem', { name: t.feed.actions.delete }).click()

    await expect(page.getByText('Сыр и йогурт')).toHaveCount(0)
    await expect(toast(page, t.feed.toasts.deleted)).toBeVisible()
    // Фокус — на следующую строку, а не на body.
    await expect(rowButton(page, 'Кофе')).toBeFocused()
    await expect.poll(() => api.received).toContain('DELETE /transactions/:id')
    // Итог дня пересчитан сервером после удаления.
    const today = dayHeader(page, t.dates.today)
    await expect(today).toHaveText(money('Сегодня Итог дня: −450 ₽'))

    await toast(page, t.feed.toasts.deleted).getByRole('button', { name: t.common.undo }).click()
    await expect(page.getByText('Сыр и йогурт')).toBeVisible()
    await expect.poll(() => api.received).toContain('POST /transactions/:id/restore')
    await expect(today).toHaveText(money('Сегодня Итог дня: −1 740 ₽'))
  })

  test('ошибка — строка возвращается, тост с причиной', { tag: '@a11y' }, async ({ page }) => {
    const api = await setup(page)
    api.failNext.set('DELETE /transactions/:id', (route) =>
      problem(route, 403, 'transaction_readonly'),
    )
    await openFeed(page)
    await feedReady(page)
    await menuOf(page, cafe.name).click()
    await page.getByRole('menuitem', { name: t.feed.actions.delete }).click()
    await expect(toast(page, t.errors.transactionReadonly)).toBeVisible()
    await expect(page.getByText('Кофе')).toBeVisible()
    await expect(toast(page, t.feed.toasts.deleted)).toHaveCount(0)
  })
})

test(
  'API: фильтры уходят тем же набором параметров в итоги',
  { tag: '@a11y' },
  async ({ page }) => {
    await setup(page)
    const summaryRequest = page.waitForRequest((r) =>
      r.url().includes(`${API}/transactions/summary`),
    )
    await openFeed(page, '?kind=income')
    const url = new URL((await summaryRequest).url())
    expect(url.searchParams.getAll('kind')).toEqual(['income'])
  },
)

test.describe('правка', () => {
  const field = (scope: Page | Locator, name: string) =>
    scope.getByRole('textbox', { name, exact: true })
  const inlineEdit = (page: Page, title: string) =>
    page.getByRole('region', { name: t.feed.edit.inlineLabel(title) })
  const sheet = (page: Page) => page.getByRole('dialog', { name: t.feed.edit.title })
  const dairyTitle = `${food.name} › ${dairy.name}`

  test(
    'desktop: на месте строки, Enter — сохранить, Esc — отмена',
    { tag: ['@visual', '@a11y'] },
    async ({ page, isMobile }) => {
      test.skip(isMobile, 'На mobile — окно')
      const api = await setup(page)
      await openFeed(page)
      await feedReady(page)
      await rowButton(page, 'Сыр и йогурт').click()
      const form = inlineEdit(page, dairyTitle)
      await expect(field(form, t.transactions.amount)).toBeFocused()
      await expect(field(form, t.transactions.amount)).toHaveValue('1290')
      await expect(page).toHaveScreenshot('feed-edit-inline.png', { fullPage: true })
      await expectNoAxeViolations(page)

      // Esc — отмена: без запроса, фокус — на строку.
      await page.keyboard.press('Escape')
      await expect(form).toHaveCount(0)
      await expect(rowButton(page, 'Сыр и йогурт')).toBeFocused()

      // Enter на строке — открыть; Enter в форме — сохранить.
      await page.keyboard.press('Enter')
      await field(form, t.transactions.amount).fill('1500')
      await page.keyboard.press('Enter')
      await expect(form).toHaveCount(0)
      await expect(rowButton(page, 'Сыр и йогурт')).toContainText(/−1\s500\s₽/)
      await expect(rowButton(page, 'Сыр и йогурт')).toBeFocused()
      await expect(toast(page, t.feed.toasts.edited)).toBeVisible()
      await expect.poll(() => api.updates.length).toBe(1)
      expect(api.updates[0].body).toMatchObject({ kind: 'expense', amount: 150_000 })

      // Одновременно открыта одна форма.
      await rowButton(page, 'Сыр и йогурт').click()
      await rowButton(page, 'Кофе').click()
      await expect(inlineEdit(page, dairyTitle)).toHaveCount(0)
      await expect(inlineEdit(page, cafe.name)).toBeVisible()
    },
  )

  test(
    'mobile: окно правки, «Назад» закрывает',
    { tag: ['@visual', '@a11y'] },
    async ({ page, isMobile }) => {
      test.skip(!isMobile, 'На desktop — на месте строки')
      const api = await setup(page)
      await openFeed(page)
      await feedReady(page)
      await rowButton(page, 'Сыр и йогурт').click()
      const dialog = sheet(page)
      await expect(dialog).toBeVisible()
      await expect(field(dialog, t.transactions.amount)).toHaveValue('1290')
      await expect(page).toHaveScreenshot('feed-edit-sheet.png')
      await expectNoAxeViolations(page)

      // «Назад» закрывает окно, а не уводит с экрана.
      await page.goBack()
      await expect(dialog).toBeHidden()
      await expect(page).toHaveURL(/\/transactions$/)

      // Правка комментария и сохранение.
      await rowButton(page, 'Сыр и йогурт').click()
      await field(dialog, t.transactions.comment).fill('Сыр, йогурт, кефир')
      await dialog.getByRole('button', { name: t.transactions.submit.expense }).click()
      await expect(dialog).toBeHidden()
      await expect(page.getByText('Сыр, йогурт, кефир')).toBeVisible()
      await expect(rowButton(page, 'Сыр, йогурт, кефир')).toBeFocused()
      await expect.poll(() => api.updates.length).toBe(1)
      expect(api.updates[0].body).toMatchObject({ comment: 'Сыр, йогурт, кефир' })
    },
  )

  test(
    'ошибка по полю (422) — форма открыта, введённое на месте, ошибка у поля',
    { tag: '@a11y' },
    async ({ page }) => {
      const api = await setup(page)
      failTimes(api, 'PUT /transactions/:id', 1, (route) =>
        problem(route, 422, 'validation_failed', {
          errors: [{ field: 'comment', code: 'too_long', message: 'x' }],
        }),
      )
      await openFeed(page)
      await feedReady(page)
      await rowButton(page, 'Кофе').click()
      const scope = sheet(page).or(inlineEdit(page, cafe.name))
      const comment = field(scope, t.transactions.comment)
      await comment.fill('Кофе и круассан')
      await comment.press('Enter')
      await expect.poll(() => api.received).toContain('PUT /transactions/:id')
      // Форма не закрылась, введённое на месте, ошибка — у поля.
      await expect(comment).toHaveValue('Кофе и круассан')
      await expect(comment).toHaveAccessibleDescription(t.errors.field.tooLong)
      await expect(toast(page, t.feed.toasts.edited)).toHaveCount(0)
      await expectNoAxeViolations(page)
    },
  )

  test(
    'нет связи — ошибка над формой, «Повторить» отправляет снова',
    { tag: '@a11y' },
    async ({ page }) => {
      const api = await setup(page)
      failTimes(api, 'PUT /transactions/:id', 1, (route) => route.abort())
      await openFeed(page)
      await feedReady(page)
      await rowButton(page, 'Кофе').click()
      const scope = sheet(page).or(inlineEdit(page, cafe.name))
      await field(scope, t.transactions.comment).fill('Кофе и круассан')
      await field(scope, t.transactions.comment).press('Enter')
      await expect(scope.getByText(t.errors.network)).toBeVisible()
      await expect(field(scope, t.transactions.comment)).toHaveValue('Кофе и круассан')
      await scope.getByRole('button', { name: t.errors.retry }).click()
      await expect(scope).toHaveCount(0)
      await expect(page.getByText('Кофе и круассан')).toBeVisible()
      await expect(toast(page, t.feed.toasts.edited)).toBeVisible()
      expect(api.updates).toHaveLength(1)
    },
  )

  test(
    'mobile: «Дублировать» из окна правки — быстрый ввод, «Назад» закрывает его',
    { tag: '@a11y' },
    async ({ page, isMobile }) => {
      test.skip(!isMobile, 'Окно правки — только на mobile')
      await setup(page)
      await openFeed(page)
      await feedReady(page)
      const historyBefore = await page.evaluate(() => window.history.length)
      await rowButton(page, 'Сыр и йогурт').click()
      await sheet(page).getByRole('button', { name: t.feed.actions.duplicate }).click()
      const quickAdd = page.getByRole('dialog', { name: t.quickAdd.title })
      await expect(quickAdd).toBeVisible()
      await expect(sheet(page)).toBeHidden()
      await expect(field(quickAdd, t.transactions.amount)).toHaveValue('1290')
      // Быстрый ввод открылся после того, как запись окна правки ушла из истории:
      // в истории — одна запись окна, «Назад» закрывает быстрый ввод и не открывает правку.
      await expect.poll(() => page.evaluate(() => window.history.length)).toBe(historyBefore + 1)
      await page.goBack()
      await expect(quickAdd).toBeHidden()
      await expect(sheet(page)).toBeHidden()
      await expect(page).toHaveURL(/\/transactions$/)
    },
  )

  test('корректировку не правят: объяснение и «Удалить»', { tag: '@a11y' }, async ({ page }) => {
    await setup(page)
    await openFeed(page)
    await feedReady(page)
    await page.locator('[data-transaction-open]', { hasText: '+250,50' }).click()
    await expect(page.getByText(t.transactions.readonly.adjustment)).toBeVisible()
    await expect(
      page.getByRole('button', { name: t.feed.actions.delete, exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: t.feed.actions.duplicate })).toHaveCount(0)
    await expectNoAxeViolations(page)
  })

  test(
    'дублирование открывает быстрый ввод с копией, дата — сегодня',
    { tag: '@a11y' },
    async ({ page }) => {
      const api = await setup(page)
      await openFeed(page)
      await feedReady(page)
      // Операция прошлого года (единственная строка «Продукты»), копия — на сегодня.
      await menuOf(page, food.name).click()
      await page.getByRole('menuitem', { name: t.feed.actions.duplicate }).click()
      const quickAdd = page.getByRole('dialog', { name: t.quickAdd.title })
      await expect(quickAdd).toBeVisible()
      await expect(field(quickAdd, t.transactions.amount)).toHaveValue('300')
      await quickAdd.getByRole('button', { name: t.transactions.submit.expense }).click()
      await expect.poll(() => api.created.length).toBe(1)
      expect(api.created[0]).toMatchObject({ kind: 'expense', amount: 30_000, date: '2026-11-23' })
    },
  )
})
