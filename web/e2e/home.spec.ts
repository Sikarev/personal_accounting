import { expect, test, type Locator, type Page, type Route } from '@playwright/test'

import { ru as t } from '../src/shared/i18n/ru.ts'
import {
  API,
  enlargeFont,
  existingAccount,
  expectNoAxeViolations,
  fontsReady,
  horizontalOverflow,
  mockFeedApi,
  mockSignedIn,
  problem,
  transaction,
  type Category,
  type FeedMock,
  type Transaction,
} from './support.ts'

// Главная: общий баланс по валютам, счета (общие и личные, сворачиваются), последние
// операции, форма быстрого ввода на desktop. API подменяется через page.route,
// часы зафиксированы: «Сегодня» и «Вчера» в кадре не меняются день ото дня.

const NOW = new Date('2026-11-23T12:00:00+03:00')

const acc = (n: number, extra: Record<string, unknown>) => ({
  ...existingAccount,
  id: `01a1faf8-0000-7000-8000-0000000000b${n}`,
  sortOrder: n,
  hasTransactions: true,
  ...extra,
})
const card = acc(1, { name: 'Карта', balance: 4_523_050, color: 'blue' })
const cash = acc(2, { name: 'Наличные', type: 'cash', balance: 1_200_000 })
const credit = acc(3, { name: 'Кредитка', type: 'credit_card', balance: -1_500_000 })
const usd = acc(4, { name: 'Доллары', currency: 'USD', visibility: 'private', balance: 50_000 })
const vacation = acc(5, {
  name: 'Накопления на отпуск в Европе следующим летом — не трогать',
  type: 'deposit',
  currency: 'EUR',
  visibility: 'private',
  balance: 120_000,
  color: 'teal',
})
const piggy = acc(6, {
  name: 'Копилка',
  type: 'other',
  visibility: 'private',
  balance: 300_000,
  includeInTotal: false,
})
const archived = acc(7, { name: 'Старая карта', archivedAt: '2026-01-01T00:00:00Z' })
const accounts = [card, cash, credit, usd, vacation, piggy, archived]

function category(n: number, name: string, extra: Partial<Category> = {}): Category {
  return {
    id: `01a1faf8-0000-7000-8000-0000000000c${n}`,
    kind: 'expense',
    parentId: null,
    name,
    sortOrder: n,
    archivedAt: null,
    ...extra,
  }
}
const food = category(1, 'Продукты')
const cafe = category(2, 'Кафе')
const salary = category(3, 'Зарплата', { kind: 'income' })
const categories = [food, cafe, salary]

/** Операция по умолчанию — с «Карты» (у `transaction()` — счёт `existingAccount`). */
const op = (overrides: Parameters<typeof transaction>[0]) =>
  transaction({ accountId: card.id, ...overrides })

function fixture(): Transaction[] {
  return [
    op({ date: '2026-11-20', categoryId: food.id, amount: 250_000 }),
    op({ date: '2026-11-22', kind: 'income', categoryId: salary.id, amount: 15_000_000 }),
    op({
      date: '2026-11-22',
      accountId: usd.id,
      currency: 'USD',
      categoryId: cafe.id,
      amount: 1_250,
      comment: 'Ужин в аэропорту',
    }),
    op({
      date: '2026-11-23',
      kind: 'transfer',
      amount: 500_000,
      toAccountId: cash.id,
      toAmount: 500_000,
      toCurrency: 'RUB',
    }),
    op({
      date: '2026-11-23',
      accountId: cash.id,
      categoryId: cafe.id,
      amount: 45_000,
      comment: 'Кофе',
    }),
    op({
      date: '2026-11-23',
      categoryId: food.id,
      amount: 129_000,
      comment: 'Сыр и хлеб',
    }),
  ]
}

async function setup(
  page: Page,
  data: { transactions?: Transaction[]; accounts?: Record<string, unknown>[] } = {},
): Promise<FeedMock> {
  await page.clock.setFixedTime(NOW)
  await mockSignedIn(page)
  const api = await mockFeedApi(page, {
    transactions: data.transactions ?? fixture(),
    accounts: data.accounts ?? accounts,
    categories,
  })
  // Частые категории — чипами в форме на странице.
  await page.route(`**${API}/transactions/defaults`, (route) =>
    route.fulfill({
      json: {
        expenseAccountId: card.id,
        incomeAccountId: card.id,
        transfer: null,
        frequentCategories: { expense: [food.id, cafe.id], income: [salary.id] },
      },
    }),
  )
  return api
}

async function openHome(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: t.nav.home })).toBeVisible()
  await expect(balance(page)).toBeVisible()
  await fontsReady(page)
}

/** Последние операции загружены: заголовок первого дня на месте. */
async function recentReady(page: Page, firstDay: string = t.dates.today) {
  await expect(recent(page).getByRole('heading', { level: 3, name: firstDay })).toBeVisible()
}

/** Desktop: форма на странице загружена (лениво) — сумма на месте. */
async function formReady(page: Page, isMobile: boolean) {
  if (!isMobile) await expect(amount(pageForm(page))).toBeVisible()
}

const balance = (page: Page) => page.getByRole('region', { name: t.home.balanceTitle })
const recent = (page: Page) => page.getByRole('region', { name: t.home.recentTitle })
const pageForm = (page: Page) => page.getByRole('region', { name: t.home.formTitle })
const amount = (scope: Locator) =>
  scope.getByRole('textbox', { name: t.transactions.amount, exact: true })
const groupToggle = (page: Page, name: string) =>
  balance(page).getByRole('button', { name: new RegExp(`^${name}`) })
const rowButton = (page: Page, text: string) =>
  page
    .locator('[data-transaction-row]', { has: page.getByText(text, { exact: true }) })
    .locator('[data-transaction-open]')
const menuOf = (page: Page, title: string) =>
  page.getByRole('button', { name: t.feed.row.actions(title) })
const editSheet = (page: Page) => page.getByRole('dialog', { name: t.feed.edit.title })
const toast = (page: Page, text: string | RegExp) =>
  page.locator('.mantine-Notification-root').filter({ hasText: text })
/** Неразрывные пробелы Intl → обычные: так ожидания в тестах читаемы. */
const plain = (text: string | null) => (text ?? '').replace(/[  ]/g, ' ')

/** Следующие `times` запросов с ключом `key` — ответ `handler` (сеть и 5xx клиент повторяет). */
function failTimes(
  api: FeedMock,
  key: string,
  times: number,
  handler: (r: Route) => Promise<void>,
) {
  api.failNext.set(key, (route) => {
    if (times > 1) failTimes(api, key, times - 1, handler)
    return handler(route)
  })
}

test.describe('главная с данными', () => {
  test('скриншот', { tag: '@visual' }, async ({ page, isMobile }) => {
    await setup(page)
    await openHome(page)
    await recentReady(page)
    await formReady(page, isMobile)
    await expect(page).toHaveScreenshot('home.png', { fullPage: true })
  })

  test('скриншот при шрифте 200 %', { tag: '@visual' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Крупный шрифт важен на узком экране')
    await setup(page)
    await openHome(page)
    await recentReady(page)
    await enlargeFont(page)
    await expect(page).toHaveScreenshot('home-font-200.png', { fullPage: true })
  })

  test('баланс, счета и последние операции', { tag: '@a11y' }, async ({ page, isMobile }) => {
    await setup(page)
    await openHome(page)
    await recentReady(page)
    await formReady(page, isMobile)
    await expectNoAxeViolations(page)
    expect(await horizontalOverflow(page)).toBe(0)

    // Баланс по валютам: активные счета «в балансе», рубли первыми, округлено до рублей.
    // Рубли: 45 230,50 + 12 000 − 15 000 = 42 230,50 → 42 231 ₽ (копилка не в балансе).
    const amounts = balance(page).getByRole('list').first().getByRole('listitem')
    expect((await amounts.allTextContents()).map(plain)).toEqual(['42 231 ₽', '1 200 €', '500 $'])

    // Группы: общие и личные; архивный счёт не показан.
    await expect(groupToggle(page, t.accounts.shared)).toHaveAttribute('aria-expanded', 'true')
    await expect(groupToggle(page, t.accounts.private)).toHaveAttribute('aria-expanded', 'true')
    await expect(balance(page).getByText(archived.name as string)).toHaveCount(0)
    await expect(balance(page).getByText(piggy.name as string)).toBeVisible()

    // Последние операции: по дням, заголовки дней — h3 внутри блока, ссылки на разделы.
    await expect(recent(page).getByRole('heading', { level: 3 })).toHaveText([
      'Сегодня',
      'Вчера',
      'Пт, 20 ноября',
    ])
    await recent(page).getByRole('link', { name: t.home.allTransactions }).click()
    await expect(page.getByRole('heading', { level: 1, name: t.nav.transactions })).toBeVisible()
    await page.goBack()
    await balance(page).getByRole('link', { name: t.home.allAccounts }).click()
    await expect(page.getByRole('heading', { level: 1, name: t.nav.accounts })).toBeVisible()
  })

  test('запрос последних операций — 10 штук', { tag: '@a11y' }, async ({ page }) => {
    const api = await setup(page)
    await openHome(page)
    await recentReady(page)
    expect(api.listRequests.map((p) => p.get('limit'))).toContain('10')
  })

  test(
    'desktop: форма на странице, фокус при загрузке не в ней',
    { tag: '@a11y' },
    async ({ page, isMobile }) => {
      await setup(page)
      await openHome(page)
      if (isMobile) {
        // Mobile: формы на странице нет — «+» в нижней панели.
        await expect(pageForm(page)).toHaveCount(0)
        return
      }
      await formReady(page, isMobile)
      await expect(amount(pageForm(page))).not.toBeFocused()
      expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY')
    },
  )
})

test.describe('свёрнутые группы', () => {
  test('скриншот: общие свёрнуты', { tag: '@visual' }, async ({ page, isMobile }) => {
    await setup(page)
    await openHome(page)
    await recentReady(page)
    await formReady(page, isMobile)
    await groupToggle(page, t.accounts.shared).click()
    await expect(page.getByText(credit.name as string)).toHaveCount(0)
    await expect(page).toHaveScreenshot('home-collapsed.png', { fullPage: true })
  })

  test(
    'сворачивание с клавиатуры, помнится после перезагрузки',
    { tag: '@a11y' },
    async ({ page }) => {
      await setup(page)
      await openHome(page)
      const shared = groupToggle(page, t.accounts.shared)
      await shared.focus()
      await page.keyboard.press('Enter')
      await expect(shared).toHaveAttribute('aria-expanded', 'false')
      await expect(balance(page).getByText(credit.name as string, { exact: true })).toHaveCount(0)
      await expectNoAxeViolations(page)

      await page.reload()
      await expect(groupToggle(page, t.accounts.shared)).toHaveAttribute('aria-expanded', 'false')
      await expect(groupToggle(page, t.accounts.private)).toHaveAttribute('aria-expanded', 'true')
      await groupToggle(page, t.accounts.shared).click()
      await expect(balance(page).getByText(credit.name as string, { exact: true })).toBeVisible()
    },
  )

  test('без localStorage всё работает', { tag: '@a11y' }, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('SecurityError')
        },
      })
    })
    await setup(page)
    await openHome(page)
    await groupToggle(page, t.accounts.private).click()
    await expect(groupToggle(page, t.accounts.private)).toHaveAttribute('aria-expanded', 'false')
  })
})

test.describe('состояния', () => {
  test('нет операций', { tag: ['@visual', '@a11y'] }, async ({ page, isMobile }) => {
    await setup(page, { transactions: [], accounts: [existingAccount] })
    await openHome(page)
    await expect(recent(page).getByRole('heading', { name: t.home.emptyTitle })).toBeVisible()
    await formReady(page, isMobile)
    await expect(page).toHaveScreenshot('home-empty.png', { fullPage: true })
    await expectNoAxeViolations(page)

    const action = recent(page).getByRole('button', {
      name: isMobile ? t.nav.addTransaction : t.home.focusForm,
    })
    await action.click()
    if (isMobile) {
      await expect(page.getByRole('dialog', { name: t.quickAdd.title })).toBeVisible()
    } else {
      // Desktop: окна нет — фокус в сумму формы рядом.
      await expect(amount(pageForm(page))).toBeFocused()
      await expect(page.getByRole('dialog')).toHaveCount(0)
    }
  })

  test(
    'ошибка блока операций — остальное работает',
    { tag: ['@visual', '@a11y'] },
    async ({ page, isMobile }) => {
      const api = await setup(page)
      failTimes(api, 'GET /transactions', 2, (route) => problem(route, 500, 'internal'))
      await openHome(page)
      await expect(recent(page).getByText(t.home.recentLoadError)).toBeVisible()
      await formReady(page, isMobile)
      await expect(groupToggle(page, t.accounts.shared)).toBeVisible()
      await expect(page).toHaveScreenshot('home-recent-error.png', { fullPage: true })
      await expectNoAxeViolations(page)

      await recent(page).getByRole('button', { name: t.errors.retry }).click()
      await recentReady(page)
    },
  )

  test('ошибка блока счетов — операции на месте', { tag: '@a11y' }, async ({ page }) => {
    await setup(page)
    let fail = true
    await page.route(`**${API}/accounts`, (route) =>
      fail && route.request().method() === 'GET'
        ? problem(route, 500, 'internal')
        : route.fallback(),
    )
    await page.goto('/')
    await expect(page.getByText(t.home.accountsLoadError)).toBeVisible()
    await recentReady(page)
    await expectNoAxeViolations(page)
    fail = false
    await page.getByRole('main').getByRole('button', { name: t.errors.retry }).first().click()
    await expect(balance(page)).toBeVisible()
  })

  test(
    'ошибка блока счетов: в строках нет подписи счёта; без формы — «Добавить операцию»',
    { tag: '@a11y' },
    async ({ page }) => {
      await setup(page)
      await page.route(`**${API}/accounts`, (route) =>
        route.request().method() === 'GET' ? problem(route, 500, 'internal') : route.fallback(),
      )
      await page.goto('/')
      await expect(page.getByText(t.home.accountsLoadError)).toBeVisible()
      await recentReady(page)
      // Счета не загружены — не «Счёт недоступен», а без подписи; перевод — «Перевод».
      await expect(recent(page).getByText(t.feed.row.unknownAccount)).toHaveCount(0)
      await expect(recent(page).getByText(t.transactions.kinds.transfer)).toBeVisible()
      // Формы на странице нет (и на desktop) — пустому блоку некуда вести, кроме окна.
      await expect(pageForm(page)).toHaveCount(0)
    },
  )

  test(
    'ошибка блока счетов без операций — кнопка открывает окно',
    { tag: '@a11y' },
    async ({ page }) => {
      await setup(page, { transactions: [] })
      await page.route(`**${API}/accounts`, (route) =>
        route.request().method() === 'GET' ? problem(route, 500, 'internal') : route.fallback(),
      )
      await page.goto('/')
      await expect(page.getByText(t.home.accountsLoadError)).toBeVisible()
      await recent(page).getByRole('button', { name: t.nav.addTransaction }).click()
      await expect(page.getByRole('dialog', { name: t.quickAdd.title })).toBeVisible()
    },
  )

  test(
    'фоновая ошибка перезапроса счетов при загруженных данных — главная на месте',
    { tag: '@a11y' },
    async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await setup(page)
      await openHome(page)
      await recentReady(page)
      // Дальше GET /accounts отвечает 500: удаление сбрасывает кэш счетов, перезапрос падает.
      let accountRequests = 0
      await page.route(`**${API}/accounts`, (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        accountRequests += 1
        return problem(route, 500, 'internal')
      })
      await menuOf(page, food.name).first().click()
      await page.getByRole('menuitem', { name: t.feed.actions.delete }).click()
      await expect.poll(() => accountRequests).toBeGreaterThanOrEqual(2)
      // Данные на месте: баланс и счета, последние операции; блока ошибки нет.
      await expect(balance(page)).toBeVisible()
      await expect(balance(page).getByText(credit.name as string)).toBeVisible()
      await expect(recent(page).getByText('Кофе')).toBeVisible()
      await expect(page.getByText(t.home.accountsLoadError)).toHaveCount(0)
      expect(errors).toEqual([])
    },
  )

  test(
    '«Повторить» в блоке операций: фокус остаётся на кнопке во время повтора и после',
    { tag: '@a11y' },
    async ({ page }) => {
      const api = await setup(page)
      let release: () => void = () => {}
      // Первая загрузка и её повтор — 500; ручной повтор ждёт и снова падает (с повтором).
      let calls = 0
      api.failNext.set('GET /transactions', function handler(route) {
        calls += 1
        if (calls < 4) api.failNext.set('GET /transactions', handler)
        if (calls === 3) {
          return new Promise<void>((resolve) => (release = resolve)).then(() =>
            problem(route, 500, 'internal'),
          )
        }
        return problem(route, 500, 'internal')
      })
      await openHome(page)
      const retry = recent(page).getByRole('button', { name: t.errors.retry })
      await expect(retry).toBeVisible()
      await retry.focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => calls).toBe(3)
      await expect(retry).toHaveAttribute('aria-busy', 'true')
      await expect(retry).toBeFocused()
      release()
      await expect.poll(() => calls).toBe(4)
      await expect(retry).not.toHaveAttribute('aria-busy')
      await expect(retry).toBeFocused()
      await expect(recent(page).getByText(t.home.recentLoadError)).toBeVisible()
    },
  )

  test(
    '«Повторить» в блоке счетов: фокус остаётся на кнопке во время повтора и после',
    { tag: '@a11y' },
    async ({ page }) => {
      await setup(page)
      let release: () => void = () => {}
      let calls = 0
      await page.route(`**${API}/accounts`, async (route) => {
        if (route.request().method() !== 'GET') return route.fallback()
        calls += 1
        if (calls === 3) await new Promise<void>((resolve) => (release = resolve))
        return problem(route, 500, 'internal')
      })
      await page.goto('/')
      const block = page.getByText(t.home.accountsLoadError).locator('../..')
      const retry = block.getByRole('button', { name: t.errors.retry })
      await expect(retry).toBeVisible()
      await retry.focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => calls).toBe(3)
      await expect(retry).toHaveAttribute('aria-busy', 'true')
      await expect(retry).toBeFocused()
      release()
      await expect.poll(() => calls).toBe(4)
      await expect(retry).not.toHaveAttribute('aria-busy')
      await expect(retry).toBeFocused()
    },
  )

  test('загрузка: скелетон блока операций', { tag: '@a11y' }, async ({ page }) => {
    const api = await setup(page)
    let release: () => void = () => {}
    api.failNext.set('GET /transactions', (_route, proceed) =>
      new Promise<void>((resolve) => (release = resolve)).then(proceed),
    )
    await openHome(page)
    // Скелетон — после 300 мс, с подписью для диктора.
    await expect(recent(page).getByRole('status')).toBeVisible()
    release()
    await recentReady(page)
    await expect(recent(page).getByRole('status')).toHaveCount(0)
  })

  test(
    'длинные названия, огромные суммы, много валют — без горизонтального скролла',
    { tag: '@a11y' },
    async ({ page }) => {
      const huge = [
        acc(1, {
          name: 'Основная зарплатная карта с кешбэком на всё и сразу',
          balance: 9_999_999_999_999,
        }),
        acc(2, { name: 'Наличные', currency: 'USD', balance: -9_999_999_999_999 }),
        acc(3, {
          name: 'Евро',
          currency: 'EUR',
          balance: 9_999_999_999_999,
          visibility: 'private',
        }),
        acc(4, { name: 'Юани', currency: 'CNY', balance: 123_456, visibility: 'private' }),
      ]
      await setup(page, {
        accounts: huge,
        transactions: [
          transaction({
            date: '2026-11-23',
            categoryId: food.id,
            amount: 9_999_999_999_999,
            comment: 'Очень длинный комментарий к операции, который не помещается в строку',
          }),
        ],
      })
      await openHome(page)
      await recentReady(page)
      expect(await horizontalOverflow(page)).toBe(0)
      await enlargeFont(page)
      expect(await horizontalOverflow(page)).toBe(0)
      await expectNoAxeViolations(page)
    },
  )

  test(
    'шрифт 200 %: баланс не рвётся по символам',
    { tag: '@a11y' },
    async ({ page, isMobile }) => {
      test.skip(!isMobile, 'Крупный шрифт важен на узком экране')
      await setup(page)
      await openHome(page)
      await enlargeFont(page)
      expect(await horizontalOverflow(page)).toBe(0)
      // Главная сумма «42 231 ₽» переносится только по разрядам: каждая строка — целая группа
      // цифр (со знаком валюты в конце), а не обрывок.
      const lines = await balance(page)
        .getByRole('listitem')
        .first()
        .evaluate((li) => {
          const range = document.createRange()
          range.selectNodeContents(li)
          const rects = [...range.getClientRects()]
          return new Set(rects.map((r) => Math.round(r.top))).size
        })
      expect(lines).toBeLessThanOrEqual(2)
    },
  )
})

test.describe('действия с последними операциями', () => {
  test(
    'desktop: сохранение из формы на странице — тост и операция в последних',
    { tag: '@a11y' },
    async ({ page, isMobile }) => {
      test.skip(isMobile, 'Форма на странице — только на desktop')
      const api = await setup(page)
      await openHome(page)
      await recentReady(page)
      const form = pageForm(page)
      await amount(form).fill('590')
      await form.getByRole('radio', { name: food.name, exact: true }).locator('..').click()
      await form.getByRole('textbox', { name: t.transactions.comment }).fill('Молоко')
      await amount(form).press('Enter')

      await expect(toast(page, /Расход\s590\s₽\s·\sПродукты/)).toBeVisible()
      expect(api.created).toHaveLength(1)
      // Форма очищена, фокус — в сумме; операция появилась в последних.
      await expect(amount(form)).toHaveValue('')
      await expect(amount(form)).toBeFocused()
      await expect(recent(page).getByText('Молоко')).toBeVisible()
    },
  )

  test('правка из последних — в окне', { tag: '@a11y' }, async ({ page }) => {
    const api = await setup(page)
    await openHome(page)
    await recentReady(page)
    await rowButton(page, 'Кофе').click()
    const sheet = editSheet(page)
    await expect(sheet).toBeVisible()
    const comment = sheet.getByRole('textbox', { name: t.transactions.comment })
    await expect(comment).toHaveValue('Кофе')
    await expectNoAxeViolations(page)
    await comment.fill('Кофе с собой')
    await comment.press('Enter')

    await expect(sheet).toBeHidden()
    await expect(toast(page, t.feed.toasts.edited)).toBeVisible()
    await expect(recent(page).getByText('Кофе с собой')).toBeVisible()
    expect(api.updates).toHaveLength(1)
    // Фокус вернулся на строку.
    await expect(rowButton(page, 'Кофе с собой')).toBeFocused()
  })

  test(
    'удаление — сразу, с «Отменить»; фокус на соседней строке',
    { tag: '@a11y' },
    async ({ page }) => {
      const api = await setup(page)
      await openHome(page)
      await recentReady(page)
      await menuOf(page, food.name).first().click()
      await page.getByRole('menuitem', { name: t.feed.actions.delete }).click()

      await expect(recent(page).getByText('Сыр и хлеб')).toHaveCount(0)
      await expect(rowButton(page, 'Кофе')).toBeFocused()
      await expect.poll(() => api.received).toContain('DELETE /transactions/:id')

      await toast(page, t.feed.toasts.deleted).getByRole('button', { name: t.common.undo }).click()
      await expect(recent(page).getByText('Сыр и хлеб')).toBeVisible()
      await expect.poll(() => api.received).toContain('POST /transactions/:id/restore')
    },
  )

  test('удаление из окна правки', { tag: '@a11y' }, async ({ page }) => {
    await setup(page)
    await openHome(page)
    await recentReady(page)
    await rowButton(page, 'Кофе').click()
    await editSheet(page).getByRole('button', { name: t.feed.actions.delete }).click()
    await expect(editSheet(page)).toBeHidden()
    await expect(recent(page).getByText('Кофе', { exact: true })).toHaveCount(0)
    await expect(toast(page, t.feed.toasts.deleted)).toBeVisible()
  })

  test('дублирование — быстрый ввод с копией', { tag: '@a11y' }, async ({ page }) => {
    await setup(page)
    await openHome(page)
    await recentReady(page)
    await menuOf(page, food.name).first().click()
    await page.getByRole('menuitem', { name: t.feed.actions.duplicate }).click()
    const quickAdd = page.getByRole('dialog', { name: t.quickAdd.title })
    await expect(amount(quickAdd)).toHaveValue('1290')
    await page.keyboard.press('Escape')
    await expect(quickAdd).toBeHidden()
    await expect(rowButton(page, 'Сыр и хлеб')).toBeFocused()
  })
})
