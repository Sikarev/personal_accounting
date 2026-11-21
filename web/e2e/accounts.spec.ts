import { expect, test, type Locator, type Page, type Route } from '@playwright/test'

import { ru as t } from '../src/shared/i18n/ru.ts'
import {
  API,
  enlargeFont,
  expectNoAxeViolations,
  fontsReady,
  horizontalOverflow,
  mockSignedIn,
  problem,
} from './support.ts'

// Экран «Счета»: список с группами и архивом, пустое состояние, окна создания
// и корректировки, перетаскивание (мышь, клавиатура, касание), архив и удаление с отменой.
// API подменяется через page.route — с состоянием, чтобы мутации отражались в списке.

/** Схема `Account` контракта (своя копия — см. комментарий к `Me` в support.ts). */
type Account = {
  id: string
  name: string
  type: 'cash' | 'card' | 'bank_account' | 'deposit' | 'credit_card' | 'other'
  currency: string
  visibility: 'shared' | 'private'
  initialBalance: number
  balance: number
  includeInTotal: boolean
  color: string | null
  sortOrder: number
  archivedAt: string | null
  hasTransactions: boolean
}

let seq = 0
function account(overrides: Partial<Account> & Pick<Account, 'name'>): Account {
  seq += 1
  return {
    id: `01a1faf8-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    type: 'card',
    currency: 'RUB',
    visibility: 'shared',
    initialBalance: 0,
    balance: 0,
    includeInTotal: true,
    color: null,
    sortOrder: seq,
    archivedAt: null,
    hasTransactions: true,
    ...overrides,
  }
}

function fixture(): Account[] {
  return [
    account({ name: 'Карта Сбер', color: 'green', balance: 4_523_050 }),
    account({ name: 'Наличные', type: 'cash', balance: 1_200_000, hasTransactions: false }),
    account({ name: 'Кредитка', type: 'credit_card', color: 'red', balance: -3_500_000 }),
    account({
      name: 'Накопительный счёт на отпуск в следующем году — не трогать до лета',
      type: 'deposit',
      balance: 99_999_999_999_999,
      includeInTotal: false,
    }),
    account({ name: 'Доллары', currency: 'USD', visibility: 'private', balance: 5_000 }),
    account({
      name: 'Заначка',
      type: 'other',
      visibility: 'private',
      color: 'yellow',
      balance: -1_000,
    }),
    account({ name: 'Старая карта', archivedAt: '2026-11-01T10:00:00Z', balance: 0 }),
  ]
}

const currencies = {
  items: [
    { code: 'RUB', name: 'Российский рубль', symbol: '₽', minorUnits: 2 },
    { code: 'USD', name: 'Доллар США', symbol: '$', minorUnits: 2 },
  ],
}

type MockApi = {
  accounts: Account[]
  /** Тела запросов `PUT /accounts/order`. */
  orders: string[][]
  /**
   * Ответить на следующий запрос этим обработчиком вместо обычного; `proceed` —
   * обычная обработка (чтобы, например, задержать ответ, а потом ответить как всегда).
   */
  failNext: Map<string, (route: Route, proceed: () => Promise<void>) => Promise<void>>
  /** Ключи запросов («PUT /accounts/order») в порядке прихода — до ответа на них. */
  received: string[]
}

/** Подменить API счетов: список, создание, порядок, архив, удаление, корректировка. */
async function mockAccountsApi(page: Page, accounts: Account[] = fixture()): Promise<MockApi> {
  const api: MockApi = { accounts, orders: [], failNext: new Map(), received: [] }
  const find = (id: string) => api.accounts.find((a) => a.id === id)!
  const override = (key: string) => {
    const handler = api.failNext.get(key)
    api.failNext.delete(key)
    return handler
  }

  await page.route(`**${API}/currencies`, (route) => route.fulfill({ json: currencies }))
  await page.route(`**${API}/accounts**`, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.slice(API.length)
    const method = request.method()
    const key = `${method} ${path.replace(/[0-9a-f-]{36}/, ':id')}`
    api.received.push(key)
    const custom = override(key)
    const id = path.split('/')[2]
    const proceed = () => respond(route, key, id)
    return custom ? custom(route, proceed) : proceed()
  })

  async function respond(route: Route, key: string, id: string): Promise<void> {
    const request = route.request()
    switch (key) {
      case 'GET /accounts':
        return route.fulfill({ json: { items: api.accounts } })
      case 'POST /accounts': {
        const body = request.postDataJSON()
        const created = account({
          ...body,
          balance: body.initialBalance ?? 0,
          hasTransactions: false,
        })
        api.accounts.push(created)
        return route.fulfill({ status: 201, json: created })
      }
      case 'PUT /accounts/order': {
        const ids: string[] = request.postDataJSON().accountIds
        api.orders.push(ids)
        ids.forEach((accountId, index) => (find(accountId).sortOrder = index))
        return route.fulfill({ status: 204 })
      }
      case 'POST /accounts/:id/archive':
        find(id).archivedAt = '2026-11-21T10:00:00Z'
        return route.fulfill({ json: find(id) })
      case 'POST /accounts/:id/unarchive':
        find(id).archivedAt = null
        return route.fulfill({ json: find(id) })
      case 'DELETE /accounts/:id':
        api.accounts = api.accounts.filter((a) => a.id !== id)
        return route.fulfill({ status: 204 })
      case 'POST /accounts/:id/adjust-balance': {
        const target = find(id)
        target.balance = request.postDataJSON().balance
        return route.fulfill({ json: { account: target, transactionId: 'tx-1' } })
      }
    }
    return problem(route, 404, 'not_found')
  }
  return api
}

async function openAccounts(page: Page, heading: string | RegExp = t.accounts.shared) {
  await page.goto('/accounts')
  await expect(page.getByRole('heading', { level: 1, name: t.nav.accounts })).toBeVisible()
  await expect(page.getByRole('heading', { name: heading })).toBeVisible()
  await fontsReady(page)
}

const sharedList = (page: Page) =>
  page.getByRole('list', { name: t.accounts.listLabel(t.accounts.shared) })

/** Названия счетов группы в показанном порядке. */
async function names(list: Locator) {
  return list
    .getByRole('button', { name: /^Переместить/ })
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')!.slice(13, -1)))
}

async function expandArchive(page: Page) {
  await page.getByRole('button', { name: t.accounts.archive(1) }).click()
}

async function openCreate(page: Page) {
  await page.getByRole('button', { name: t.accounts.create }).first().click()
  const dialog = page.getByRole('dialog', { name: t.accounts.form.createTitle })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openAdjust(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click()
  await page.getByRole('button', { name: t.accounts.actions.adjust }).click()
  const dialog = page.getByRole('dialog', { name: t.accounts.adjust.title })
  await expect(dialog.getByLabel(t.accounts.adjust.actual)).toBeFocused()
  return dialog
}

/**
 * Клавиша во время перетаскивания «Кредитки» и ожидание объявления диктора о позиции:
 * сенсор dnd-kit обрабатывает шаг асинхронно, без ожидания быстрые нажатия теряются.
 */
async function press(page: Page, key: string, position: number) {
  await page.keyboard.press(key)
  await expect(page.getByText(`«Кредитка»: позиция ${position} из 4.`)).toBeAttached()
}

/** `data-account-row` элемента с фокусом (или имя тега, если фокус не на строке счёта). */
const focusedRow = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    return el?.dataset.accountRow ?? el?.tagName ?? null
  })

const idOf = (accounts: Account[], name: string) => accounts.find((a) => a.name === name)!.id

/** Тост — по тексту: у Mantine нет роли у уведомления. */
const toast = (page: Page, text: string | RegExp) =>
  page.locator('.mantine-Notification-root').filter({ hasText: text })

test.beforeEach(async ({ page }) => {
  await mockSignedIn(page)
})

test.describe('список', () => {
  test('скриншот: обе группы и раскрытый архив', { tag: '@visual' }, async ({ page }) => {
    await mockAccountsApi(page)
    await openAccounts(page)
    await expandArchive(page)
    await expect(page).toHaveScreenshot('accounts.png', { fullPage: true })
  })

  test('доступность, итог по валютам, архив', { tag: '@a11y' }, async ({ page }) => {
    await mockAccountsApi(page)
    await openAccounts(page)
    // Итог — по каждой валюте отдельно, без счёта «не в общем балансе».
    // Каждая валюта — отдельный пункт списка.
    const totals = await page
      .getByRole('region', { name: t.accounts.total })
      .getByRole('listitem')
      .allTextContents()
    expect(totals.map((x) => x.replace(/\s/g, ' '))).toEqual(['22 220,50 ₽', '50 $'])
    // <wbr> не попадает в текст: копируется та же сумма.
    // Пустых групп нет, у личных — пояснение.
    await expect(page.getByText(t.accounts.privateHint)).toBeVisible()
    // Архив свёрнут, раскрывается кнопкой.
    const archiveButton = page.getByRole('button', { name: t.accounts.archive(1) })
    await expect(archiveButton).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText('Старая карта')).toHaveCount(0)
    await archiveButton.click()
    await expect(archiveButton).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('button', { name: 'Вернуть «Старая карта»' })).toBeVisible()
    await expectNoAxeViolations(page)
    expect(await horizontalOverflow(page)).toBe(0)
  })

  test(
    'отрицательный остаток: красный у карты, обычный у кредитки',
    { tag: '@a11y' },
    async ({ page }) => {
      await mockAccountsApi(page)
      await openAccounts(page)
      const color = (name: string) =>
        page
          .getByRole('button', { name: new RegExp(`^${name}`) })
          .locator('span', { hasText: '−' })
          .last()
          .evaluate((el) => getComputedStyle(el).color)
      const text = await page.locator('body').evaluate((el) => getComputedStyle(el).color)
      expect(await color('Кредитка')).toBe(text)
      expect(await color('Заначка')).not.toBe(text)
    },
  )

  test('шрифт 200 %: скриншот', { tag: '@visual' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Проверяем на узком экране — там теснее всего')
    await mockAccountsApi(page)
    await openAccounts(page)
    await enlargeFont(page)
    await expect(page).toHaveScreenshot('accounts-font-200.png', { fullPage: true })
  })

  test('шрифт 200 %: нет горизонтального скролла', { tag: '@a11y' }, async ({ page }) => {
    await mockAccountsApi(page)
    await openAccounts(page)
    await expandArchive(page)
    await enlargeFont(page)
    expect(await horizontalOverflow(page)).toBe(0)
  })

  test('зоны касания строк и ручек не меньше 44 px', { tag: '@a11y' }, async ({ page }) => {
    await mockAccountsApi(page)
    await openAccounts(page)
    const targets = await sharedList(page).getByRole('button').all()
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      const box = await target.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  })
})

test.describe('состояния', () => {
  test('пусто: скриншот', { tag: '@visual' }, async ({ page }) => {
    await mockAccountsApi(page, [])
    await openAccounts(page, t.pages.accounts.emptyTitle)
    await expect(page).toHaveScreenshot('accounts-empty.png')
  })

  test('пусто: доступность и действие', { tag: '@a11y' }, async ({ page }) => {
    await mockAccountsApi(page, [])
    await openAccounts(page, t.pages.accounts.emptyTitle)
    await expectNoAxeViolations(page)
    // Кнопка создания одна — в пустом состоянии, а не ещё и в заголовке.
    await expect(page.getByRole('button', { name: t.accounts.create })).toHaveCount(1)
    await openCreate(page)
  })

  test('ошибка загрузки: текст и «Повторить»', { tag: '@a11y' }, async ({ page }) => {
    await mockAccountsApi(page)
    // 5xx QueryClient повторяет один раз — обе попытки падают, «Повторить» уже проходит.
    let failures = 2
    await page.route(`**${API}/accounts`, (route, request) =>
      request.method() === 'GET' && failures-- > 0
        ? problem(route, 500, 'internal')
        : route.fallback(),
    )
    await openAccounts(page, t.accounts.loadError)
    await expect(page.getByText(t.errors.server)).toBeVisible()
    await expectNoAxeViolations(page)
    await page.getByRole('button', { name: t.errors.retry }).click()
    await expect(page.getByRole('heading', { name: t.accounts.shared })).toBeVisible()
  })

  test('загрузка: скелетон после задержки', { tag: '@a11y' }, async ({ page }) => {
    await mockAccountsApi(page)
    await page.route(`**${API}/accounts`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return route.fallback()
    })
    await page.goto('/accounts')
    await expect(page.getByRole('status').filter({ hasText: t.common.loading })).toBeAttached()
    await expect(page.getByRole('heading', { name: t.accounts.shared })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: t.common.loading })).toHaveCount(0)
  })
})

test.describe('создание', () => {
  test('скриншот окна', { tag: '@visual' }, async ({ page }) => {
    await mockAccountsApi(page)
    await openAccounts(page)
    const dialog = await openCreate(page)
    await expect(dialog.getByLabel(t.accounts.form.name)).toBeFocused()
    await expect(page).toHaveScreenshot('accounts-create.png')
  })

  test('доступность окна и выбор цвета с клавиатуры', { tag: '@a11y' }, async ({ page }) => {
    await mockAccountsApi(page)
    await openAccounts(page)
    const dialog = await openCreate(page)
    await expectNoAxeViolations(page)
    const group = dialog.getByRole('radiogroup', { name: t.accounts.form.color })
    // Tab входит в группу на выбранный («Без цвета»), стрелка выбирает следующий.
    await group.getByRole('radio', { name: t.accounts.colors.none }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(group.getByRole('radio', { name: t.accounts.colors.blue })).toBeChecked()
  })

  test('создаёт счёт с введёнными полями', { tag: '@a11y' }, async ({ page }) => {
    await mockAccountsApi(page, fixture())
    await openAccounts(page)
    const dialog = await openCreate(page)
    const requestPromise = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().endsWith(`${API}/accounts`),
    )
    await dialog.getByLabel(t.accounts.form.name).fill('  Новая карта  ')
    await dialog.getByLabel(t.accounts.form.type).selectOption(t.accounts.types.bank_account)
    await dialog.getByLabel(t.accounts.form.currency).selectOption('USD')
    await dialog.getByLabel(t.accounts.form.initialBalance).fill('−1 250,5')
    await dialog.getByRole('radio', { name: t.accounts.form.visibilityPrivate }).check()
    await dialog.getByLabel(t.accounts.form.includeInTotal).uncheck()
    await dialog.getByRole('radio', { name: t.accounts.colors.teal }).locator('..').click()
    await dialog.getByRole('button', { name: t.accounts.form.submitCreate }).click()

    expect((await requestPromise).postDataJSON()).toEqual({
      name: 'Новая карта',
      type: 'bank_account',
      currency: 'USD',
      initialBalance: -125050,
      visibility: 'private',
      includeInTotal: false,
      color: 'teal',
    })
    await expect(dialog).toBeHidden()
    const privateList = page.getByRole('list', { name: t.accounts.listLabel(t.accounts.private) })
    await expect(privateList.getByText('Новая карта')).toBeVisible()
  })

  test(
    'ошибки: у полей и нет связи — введённое не теряется',
    { tag: '@a11y' },
    async ({ page }) => {
      const api = await mockAccountsApi(page)
      await openAccounts(page)
      const dialog = await openCreate(page)
      const submit = dialog.getByRole('button', { name: t.accounts.form.submitCreate })

      // Клиентская проверка: пустое название, лишние знаки после запятой.
      await dialog.getByLabel(t.accounts.form.initialBalance).fill('10,555')
      await submit.click()
      await expect(dialog.getByText(t.accounts.form.nameRequired)).toBeVisible()
      await expect(dialog.getByText(t.moneyInput.tooManyDecimals(2))).toBeVisible()
      await expect(dialog.getByLabel(t.accounts.form.name)).toBeFocused()

      // Нет связи: сообщение с «Повторить», поля сохранены.
      await dialog.getByLabel(t.accounts.form.name).fill('Карта')
      await dialog.getByLabel(t.accounts.form.initialBalance).fill('10,55')
      api.failNext.set('POST /accounts', (route) => route.abort('internetdisconnected'))
      await submit.click()
      await expect(dialog.getByRole('alert')).toContainText(t.errors.network)
      await expect(dialog.getByLabel(t.accounts.form.name)).toHaveValue('Карта')
      await expect(dialog.getByLabel(t.accounts.form.initialBalance)).toHaveValue('10,55')
      await dialog.getByRole('button', { name: t.errors.retry }).click()
      await expect(dialog).toBeHidden()
    },
  )
})

test.describe('корректировка остатка', () => {
  test('скриншот окна', { tag: '@visual' }, async ({ page }) => {
    await mockAccountsApi(page)
    await openAccounts(page)
    await openAdjust(page, 'Карта Сбер')
    await expect(page).toHaveScreenshot('accounts-adjust.png')
  })

  test('доступность, тост с суммой корректировки', { tag: '@a11y' }, async ({ page }) => {
    await mockAccountsApi(page)
    await openAccounts(page)
    const dialog = await openAdjust(page, 'Карта Сбер')
    await expectNoAxeViolations(page)
    await dialog.getByLabel(t.accounts.adjust.actual).fill('46 000')
    await dialog.getByRole('button', { name: t.accounts.adjust.submit }).click()
    await expect(dialog).toBeHidden()
    // 46 000 − 45 230,50 = +769,50; «Отменить» нет — удаления операций ещё нет.
    const done = toast(page, t.accounts.adjust.done)
    await expect(done).toContainText('+769,50')
    await expect(done.getByRole('button', { name: t.common.undo })).toHaveCount(0)
  })

  test('архивный счёт: понятная ошибка 409', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockAccountsApi(page)
    await openAccounts(page)
    const dialog = await openAdjust(page, 'Карта Сбер')
    api.failNext.set('POST /accounts/:id/adjust-balance', (route) =>
      problem(route, 409, 'account_archived'),
    )
    await dialog.getByLabel(t.accounts.adjust.actual).fill('1')
    await dialog.getByRole('button', { name: t.accounts.adjust.submit }).click()
    await expect(dialog.getByRole('alert')).toContainText(t.errors.accountArchived)
  })
})

test.describe('архив и удаление', () => {
  test('архив сразу, «Отменить» возвращает', { tag: '@a11y' }, async ({ page }) => {
    await mockAccountsApi(page)
    await openAccounts(page)
    await page.getByRole('button', { name: /^Карта Сбер/ }).click()
    await page.getByRole('button', { name: t.accounts.actions.archive }).click()
    await expect(sharedList(page).getByText('Карта Сбер')).toHaveCount(0)
    await expect(page.getByRole('button', { name: t.accounts.archive(2) })).toBeVisible()
    await toast(page, t.accounts.toasts.archived('Карта Сбер'))
      .getByRole('button', { name: t.common.undo })
      .click()
    await expect(sharedList(page).getByText('Карта Сбер')).toBeVisible()
    await expect(page.getByRole('button', { name: t.accounts.archive(1) })).toBeVisible()
  })

  test('удаление и отмена: счёт на прежнем месте', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockAccountsApi(page)
    await openAccounts(page)
    const before = await names(sharedList(page))
    await page.getByRole('button', { name: /^Наличные/ }).click()
    await page.getByRole('button', { name: t.accounts.actions.delete }).click()
    await expect(sharedList(page).getByText('Наличные')).toHaveCount(0)
    await toast(page, t.accounts.toasts.deleted('Наличные'))
      .getByRole('button', { name: t.common.undo })
      .click()
    await expect.poll(() => names(sharedList(page))).toEqual(before)
    // Новый id стоит на месте старого в запросе порядка.
    expect(api.orders.at(-1)).toHaveLength(before.length)
  })

  test('у счёта с операциями нет «Удалить»', { tag: '@a11y' }, async ({ page }) => {
    await mockAccountsApi(page)
    await openAccounts(page)
    await page.getByRole('button', { name: /^Карта Сбер/ }).click()
    await expect(page.getByRole('button', { name: t.accounts.actions.archive })).toBeVisible()
    await expect(page.getByRole('button', { name: t.accounts.actions.delete })).toHaveCount(0)
  })

  test('409 при удалении: откат и предложение архивировать', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockAccountsApi(page)
    api.failNext.set('DELETE /accounts/:id', (route) =>
      problem(route, 409, 'account_has_transactions'),
    )
    await openAccounts(page)
    await page.getByRole('button', { name: /^Наличные/ }).click()
    await page.getByRole('button', { name: t.accounts.actions.delete }).click()
    const warning = toast(page, t.accounts.toasts.hasTransactions)
    await expect(warning).toBeVisible()
    await expect(sharedList(page).getByRole('button', { name: /^Наличные/ })).toBeVisible()
    await warning.getByRole('button', { name: t.accounts.actions.archive }).click()
    await expect(sharedList(page).getByRole('button', { name: /^Наличные/ })).toHaveCount(0)
  })
})

test.describe('перетаскивание', () => {
  test('клавиатура: пробел, стрелка, пробел', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockAccountsApi(page)
    await openAccounts(page)
    const handle = page.getByRole('button', { name: t.sortable.handle('Кредитка') })
    await handle.focus()
    await press(page, 'Space', 3)
    await press(page, 'ArrowUp', 2)
    await press(page, 'ArrowUp', 1)
    await page.keyboard.press('Space')
    await expect
      .poll(() => names(sharedList(page)))
      .toEqual([
        'Кредитка',
        'Карта Сбер',
        'Наличные',
        'Накопительный счёт на отпуск в следующем году — не трогать до лета',
      ])
    await expect.poll(() => api.orders.length).toBe(1)
    // Объявление для экранного диктора — по-русски.
    await expect(page.getByText('«Кредитка» поставлен на позицию 1 из 4.')).toBeAttached()
  })

  test('клавиатура: Esc отменяет', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockAccountsApi(page)
    await openAccounts(page)
    const before = await names(sharedList(page))
    await page.getByRole('button', { name: t.sortable.handle('Кредитка') }).focus()
    await press(page, 'Space', 3)
    await press(page, 'ArrowUp', 2)
    await page.keyboard.press('Escape')
    await expect.poll(() => names(sharedList(page))).toEqual(before)
    expect(api.orders).toHaveLength(0)
  })

  test('ошибка сервера: порядок откатывается', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockAccountsApi(page)
    api.failNext.set('PUT /accounts/order', (route) => problem(route, 500, 'internal'))
    await openAccounts(page)
    const before = await names(sharedList(page))
    await page.getByRole('button', { name: t.sortable.handle('Кредитка') }).focus()
    await press(page, 'Space', 3)
    await press(page, 'ArrowUp', 2)
    await page.keyboard.press('Space')
    await expect(toast(page, t.errors.reorderFailed)).toBeVisible()
    await expect.poll(() => names(sharedList(page))).toEqual(before)
  })

  test('мышь', { tag: '@a11y' }, async ({ page, isMobile }) => {
    test.skip(isMobile, 'На mobile — касание, отдельный тест')
    await mockAccountsApi(page)
    await openAccounts(page)
    const from = (await page
      .getByRole('button', { name: t.sortable.handle('Карта Сбер') })
      .boundingBox())!
    const to = (await page
      .getByRole('button', { name: t.sortable.handle('Кредитка') })
      .boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 10, { steps: 3 })
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 10, { steps: 10 })
    await page.mouse.up()
    await expect
      .poll(() => names(sharedList(page)))
      .toEqual([
        'Наличные',
        'Кредитка',
        'Карта Сбер',
        'Накопительный счёт на отпуск в следующем году — не трогать до лета',
      ])
  })

  test('касание: тянуть ручку пальцем', { tag: '@a11y' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Сенсорный экран эмулируется в mobile-проектах')
    await mockAccountsApi(page)
    await openAccounts(page)
    const from = (await page
      .getByRole('button', { name: t.sortable.handle('Карта Сбер') })
      .boundingBox())!
    const to = (await page
      .getByRole('button', { name: t.sortable.handle('Кредитка') })
      .boundingBox())!
    // Настоящие касания через CDP: браузер сам породит pointer-события с pointerType=touch.
    const cdp = await page.context().newCDPSession(page)
    const x = from.x + from.width / 2
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
      })
    const startY = from.y + from.height / 2
    const endY = to.y + to.height / 2 + 10
    await touch('touchStart', startY)
    for (let i = 1; i <= 10; i++) await touch('touchMove', startY + ((endY - startY) * i) / 10)
    await touch('touchEnd', endY)
    await expect
      .poll(() => names(sharedList(page)))
      .toEqual([
        'Наличные',
        'Кредитка',
        'Карта Сбер',
        'Накопительный счёт на отпуск в следующем году — не трогать до лета',
      ])
  })
})

test.describe('очередь мутаций', () => {
  test('два быстрых перетаскивания: на сервере — последнее', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockAccountsApi(page)
    // Ответ на первый PUT задерживается, пока не отпустим.
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    api.failNext.set('PUT /accounts/order', async (_route, proceed) => {
      await held
      await proceed()
    })
    await openAccounts(page)
    await page.getByRole('button', { name: t.sortable.handle('Кредитка') }).focus()
    await press(page, 'Space', 3)
    await press(page, 'ArrowUp', 2)
    await page.keyboard.press('Space')
    await expect
      .poll(() => names(sharedList(page)))
      .toEqual([
        'Карта Сбер',
        'Кредитка',
        'Наличные',
        'Накопительный счёт на отпуск в следующем году — не трогать до лета',
      ])
    await page.getByRole('button', { name: t.sortable.handle('Кредитка') }).focus()
    await page.keyboard.press('Space')
    await expect(page.getByText('«Кредитка»: позиция 2 из 4.')).toBeAttached()
    await page.keyboard.press('ArrowUp')
    await expect(page.getByText('«Кредитка»: позиция 1 из 4.')).toBeAttached()
    await page.keyboard.press('Space')
    const final = [
      'Кредитка',
      'Карта Сбер',
      'Наличные',
      'Накопительный счёт на отпуск в следующем году — не трогать до лета',
    ]
    // Интерфейс обновился сразу, а второй запрос ждёт первого в очереди.
    await expect.poll(() => names(sharedList(page))).toEqual(final)
    expect(api.received.filter((k) => k === 'PUT /accounts/order')).toHaveLength(1)

    release()
    await expect.poll(() => api.orders.length).toBe(2)
    const finalIds = final.map((name) => idOf(api.accounts, name))
    expect(api.orders[1]).toEqual(finalIds)
    // После перезапроса списка экран показывает то же, что на «сервере».
    await expect.poll(() => names(sharedList(page))).toEqual(final)
  })
})

test.describe('фокус после действий', () => {
  test('архив из окна — фокус на соседней строке', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockAccountsApi(page)
    await openAccounts(page)
    await page.getByRole('button', { name: /^Наличные/ }).click()
    await page.getByRole('button', { name: t.accounts.actions.archive }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect.poll(() => focusedRow(page)).toBe(idOf(api.accounts, 'Кредитка'))
  })

  test(
    'последний счёт группы в архив — фокус на «Архив (N)»',
    { tag: '@a11y' },
    async ({ page }) => {
      await mockAccountsApi(page, [account({ name: 'Единственный' })])
      await openAccounts(page)
      await page.getByRole('button', { name: /^Единственный/ }).click()
      await page.getByRole('button', { name: t.accounts.actions.archive }).click()
      await expect(page.getByRole('button', { name: t.accounts.archive(1) })).toBeFocused()
      // Активных счетов нет — кнопка «Создать счёт» одна, в пустом состоянии.
      await expect(page.getByRole('button', { name: t.accounts.create })).toHaveCount(1)
    },
  )

  test(
    'удаление последнего счёта — фокус на «Создать счёт»',
    { tag: '@a11y' },
    async ({ page }) => {
      await mockAccountsApi(page, [account({ name: 'Пустой', hasTransactions: false })])
      await openAccounts(page)
      await page.getByRole('button', { name: /^Пустой/ }).click()
      await page.getByRole('button', { name: t.accounts.actions.delete }).click()
      await expect(page.getByRole('button', { name: t.accounts.create })).toBeFocused()
    },
  )

  test('«Вернуть» из архива — фокус не теряется', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockAccountsApi(page)
    await openAccounts(page)
    await expandArchive(page)
    await page.getByRole('button', { name: 'Вернуть «Старая карта»' }).click()
    // Архив опустел и исчез — фокус на самой вернувшейся строке.
    await expect.poll(() => focusedRow(page)).toBe(idOf(api.accounts, 'Старая карта'))
  })
})

test.describe('отмена удаления без связи', () => {
  test(
    'тост с «Повторить» не закрывается, повтор возвращает счёт',
    { tag: '@a11y' },
    async ({ page }) => {
      const api = await mockAccountsApi(page)
      await openAccounts(page)
      await page.getByRole('button', { name: /^Наличные/ }).click()
      await page.getByRole('button', { name: t.accounts.actions.delete }).click()
      await expect(sharedList(page).getByRole('button', { name: /^Наличные/ })).toHaveCount(0)
      api.failNext.set('POST /accounts', (route) => route.abort('internetdisconnected'))
      await toast(page, t.accounts.toasts.deleted('Наличные'))
        .getByRole('button', { name: t.common.undo })
        .click()
      const failed = toast(page, t.accounts.toasts.restoreFailed('Наличные'))
      await expect(failed).toContainText(t.errors.network)
      // Тост не закрывается сам: ждём дольше обычного времени жизни тоста.
      await page.waitForTimeout(7000)
      await expect(failed).toBeVisible()
      await failed.getByRole('button', { name: t.errors.retry }).click()
      await expect(sharedList(page).getByRole('button', { name: /^Наличные/ })).toBeVisible()
      await expect(failed).toHaveCount(0)
    },
  )
})

test.describe('порядок без перетаскивания', () => {
  test('«Выше» и «Ниже» в окне счёта', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockAccountsApi(page)
    await openAccounts(page)
    await page.getByRole('button', { name: /^Наличные/ }).click()
    const dialog = page.getByRole('dialog', { name: t.accounts.form.editTitle })
    const order = dialog.getByRole('group', { name: t.accounts.actions.orderLabel })
    const down = order.getByRole('button', { name: t.accounts.actions.moveDown })
    const up = order.getByRole('button', { name: t.accounts.actions.moveUp })

    await down.click()
    await expect
      .poll(() => names(sharedList(page)))
      .toEqual([
        'Карта Сбер',
        'Кредитка',
        'Наличные',
        'Накопительный счёт на отпуск в следующем году — не трогать до лета',
      ])
    // Окно открыто, фокус на той же кнопке — можно нажимать дальше.
    await expect(down).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => api.orders.length).toBe(2)
    expect(api.orders[1].at(-1)).toBe(idOf(api.accounts, 'Наличные'))
    // Внизу группы «Ниже» неактивна, но фокус с неё не слетает.
    await expect(down).toHaveAttribute('aria-disabled', 'true')
    await expect(down).toBeFocused()
    await page.keyboard.press('Enter')
    expect(api.orders).toHaveLength(2)

    await up.click()
    await expect.poll(() => api.orders.length).toBe(3)
    await expect(up).toBeFocused()
    await expect(down).not.toHaveAttribute('aria-disabled')
    await expectNoAxeViolations(page)
  })

  test('у единственного счёта группы кнопок нет', { tag: '@a11y' }, async ({ page }) => {
    await mockAccountsApi(page)
    await openAccounts(page)
    await page.getByRole('button', { name: /^Доллары/ }).click()
    await expect(
      page.getByRole('group', { name: t.accounts.actions.orderLabel }).getByRole('button'),
    ).toHaveCount(2)
    await page.keyboard.press('Escape')
    await mockAccountsApi(page, [account({ name: 'Один' })])
    await page.reload()
    await page.getByRole('button', { name: /^Один/ }).click()
    await expect(page.getByRole('dialog', { name: t.accounts.form.editTitle })).toBeVisible()
    await expect(page.getByRole('group', { name: t.accounts.actions.orderLabel })).toHaveCount(0)
  })
})
