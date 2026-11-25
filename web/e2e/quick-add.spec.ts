import { expect, test, type Locator, type Page } from '@playwright/test'

import { ru as t } from '../src/shared/i18n/ru.ts'
import {
  API,
  collectWindowErrors,
  enlargeFont,
  existingAccount,
  expectNoAxeViolations,
  fontsReady,
  horizontalOverflow,
  mockSignedIn,
  mockTransactionsApi,
  problem,
  type MockTransactionsApi,
} from './support.ts'

// Быстрый ввод операции (ux.md, §3): окно по кнопке «+» / «Добавить операцию».
// API подменяется через page.route (под vite preview бэкенда нет).

const id = (n: number) => `01a1faf8-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`

const card = {
  ...existingAccount,
  id: id(1),
  name: 'Карта',
  balance: 4_523_050,
  baseBalance: 4_523_050,
}
const cash = { ...existingAccount, id: id(2), name: 'Наличные', type: 'cash', sortOrder: 1 }
const usd = {
  ...existingAccount,
  id: id(3),
  name: 'Доллары',
  currency: 'USD',
  visibility: 'private',
  balance: 50_000,
  baseBalance: 4_617_500, // 500 $ × 92,35 ₽
}

function category(n: number, name: string, kind = 'expense', parentId: string | null = null) {
  return { id: id(50 + n), kind, parentId, name, sortOrder: n, archivedAt: null }
}
const food = category(1, 'Продукты')
const cafe = category(2, 'Кафе и рестораны')
const transport = category(3, 'Транспорт')
const taxi = category(4, 'Такси', 'expense', transport.id)
const health = category(5, 'Здоровье')
const salary = category(6, 'Зарплата', 'income')
const categories = [food, cafe, transport, taxi, health, salary]
/** Подкатегория в чипе и списке — «Родитель › Подкатегория». */
const taxiLabel = 'Транспорт › Такси'

const defaults = {
  expenseAccountId: card.id,
  incomeAccountId: null,
  transfer: { accountId: card.id, toAccountId: usd.id },
  frequentCategories: { expense: [food.id, taxi.id, cafe.id, health.id], income: [salary.id] },
}

/** «Сегодня» в поясе пользователя (meFixture — Москва), как считает приложение. */
function today(): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Неразрывные пробелы Intl → обычные: так ожидания в тестах читаемы. */
const plain = (text: string | null) => (text ?? '').replace(/[  ]/g, ' ')

async function mockApi(
  page: Page,
  init: Parameters<typeof mockTransactionsApi>[1] = {},
): Promise<MockTransactionsApi> {
  await mockSignedIn(page)
  return mockTransactionsApi(page, {
    accounts: [card, cash, usd],
    categories,
    defaults,
    ...init,
  })
}

const navAddButton = (page: Page) =>
  page
    .getByRole('navigation', { name: t.nav.label })
    .getByRole('button', { name: t.nav.addTransaction })

const quickAdd = (page: Page) => page.getByRole('dialog', { name: t.quickAdd.title })
const amountField = (scope: Page | Locator, name: string = t.transactions.amount) =>
  scope.getByRole('textbox', { name, exact: true })
const chip = (scope: Locator, name: string) => scope.getByRole('radio', { name, exact: true })
/** Нажать чип: input у Mantine скрыт, нажимаем на подпись (как пользователь). */
const pickChip = (scope: Locator, name: string) => chip(scope, name).locator('..').click()
const kindTab = (scope: Locator, kind: keyof typeof t.transactions.kinds) =>
  scope.getByText(t.transactions.kinds[kind], { exact: true })
const toast = (page: Page, text: string | RegExp) =>
  page.locator('.mantine-Notification-root').filter({ hasText: text })

async function openHome(page: Page, path = '/') {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await fontsReady(page)
}

/** Открыть быстрый ввод и дождаться формы: фокус — в сумме. */
async function openQuickAdd(page: Page, path = '/') {
  await openHome(page, path)
  await navAddButton(page).click()
  const dialog = quickAdd(page)
  await expect(amountField(dialog)).toBeFocused()
  await fontsReady(page)
  return dialog
}

test.describe('расход', () => {
  test('скриншот: выражение и выбранная категория', { tag: '@visual' }, async ({ page }) => {
    await mockApi(page)
    const dialog = await openQuickAdd(page)
    await page.keyboard.type('350+120*2')
    await pickChip(dialog, food.name)
    await expect(dialog.getByText(/^=/)).toBeVisible()
    await expect(page).toHaveScreenshot('quick-add-expense.png')
  })

  test('скриншот при шрифте 200 %', { tag: '@visual' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Крупный шрифт важен на узком экране')
    await mockApi(page)
    const dialog = await openQuickAdd(page)
    await enlargeFont(page)
    await page.keyboard.type('350+120*2')
    await expect(dialog.getByText(/^=/)).toBeVisible()
    await expect(page).toHaveScreenshot('quick-add-font-200.png')
  })

  test('доступность и вёрстка; фокус сразу в сумме', { tag: '@a11y' }, async ({ page }) => {
    await mockApi(page)
    const dialog = await openQuickAdd(page)
    await expect(
      dialog.getByRole('button', { name: `${t.transactions.account}: Карта` }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: `${t.datePicker.label}: ${t.dates.today}` }),
    ).toBeVisible()
    // Частые категории — чипами, в порядке defaults.
    const frequent = dialog.getByRole('group', { name: t.categories.picker.frequent })
    await expect(frequent.getByRole('radio')).toHaveCount(4)
    await expect(frequent.getByRole('radio').first()).toHaveAccessibleName(food.name)
    await page.keyboard.type('350+120*2')
    await expect(dialog.getByText(/^=/)).toHaveText(/= 590\s₽/)
    await expectNoAxeViolations(page)
    expect(await horizontalOverflow(page)).toBe(0)
  })

  test('шрифт 200 %: нет горизонтального скролла', { tag: '@a11y' }, async ({ page }) => {
    await mockApi(page)
    await openQuickAdd(page)
    await enlargeFont(page)
    expect(await horizontalOverflow(page)).toBe(0)
  })

  test(
    '≤ 3 действий: сумма → чип → Enter; тост, очистка и «Отменить»',
    { tag: '@a11y' },
    async ({ page }) => {
      const api = await mockApi(page)
      // 1. «+» (фокус уже в сумме).
      const dialog = await openQuickAdd(page)
      // 2. Сумма.
      await page.keyboard.type('590')
      // 3. Чип категории.
      await pickChip(dialog, food.name)
      // 4. Enter — прямо с чипа.
      await page.keyboard.press('Enter')

      const done = toast(page, /^Расход/)
      await expect(done).toBeVisible()
      expect(plain(await done.textContent())).toContain('Расход 590 ₽ · Продукты')
      expect(api.created).toEqual([
        {
          kind: 'expense',
          date: today(),
          accountId: card.id,
          amount: 59_000,
          categoryId: food.id,
          comment: '',
        },
      ])

      // Форма очищена, фокус — в сумме; счёт и дата остались.
      await expect(amountField(dialog)).toHaveValue('')
      await expect(amountField(dialog)).toBeFocused()
      await expect(chip(dialog, food.name)).not.toBeChecked()
      await expect(
        dialog.getByRole('button', { name: `${t.transactions.account}: Карта` }),
      ).toBeVisible()

      await done.getByRole('button', { name: t.common.undo }).click()
      await expect.poll(() => api.deleted).toEqual([`01a1faf8-0000-7000-8000-000000000001`])
      await expect(done).toHaveCount(0)
    },
  )

  test(
    'Enter из комментария; повторный Enter во время отправки не создаёт дубль',
    { tag: '@a11y' },
    async ({ page }) => {
      const api = await mockApi(page)
      api.createDelay = 800
      const dialog = await openQuickAdd(page)
      await page.keyboard.type('1200')
      await pickChip(dialog, taxiLabel)
      await dialog.getByRole('textbox', { name: t.transactions.comment }).fill('  в аэропорт  ')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      // Дольше 300 мс — индикатор на кнопке; введённое держится до ответа.
      const submit = dialog.getByRole('button', { name: t.transactions.submit.expense })
      await expect(submit).toHaveAttribute('data-loading', 'true')
      await expect(amountField(dialog)).toHaveValue('1200')
      await expect(toast(page, /^Расход/)).toBeVisible()
      expect(api.created).toHaveLength(1)
      expect(api.created[0]).toMatchObject({ categoryId: taxi.id, comment: 'в аэропорт' })
      await expect(dialog.getByRole('textbox', { name: t.transactions.comment })).toHaveValue('')
    },
  )

  test('ошибки полей: пусто, не больше нуля, неразборчиво', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockApi(page)
    const dialog = await openQuickAdd(page)
    await page.keyboard.press('Enter')
    await expect(dialog.getByText(t.amountInput.required)).toBeVisible()
    await expect(dialog.getByText(t.transactions.errors.categoryRequired)).toBeVisible()
    await expect(amountField(dialog)).toBeFocused()
    await expect(amountField(dialog)).toHaveAttribute('aria-invalid', 'true')

    await page.keyboard.type('100-200')
    await pickChip(dialog, food.name)
    await page.keyboard.press('Enter')
    await expect(dialog.getByText(t.amountInput.notPositive)).toBeVisible()

    await amountField(dialog).fill('350+*2')
    await page.keyboard.press('Enter')
    await expect(dialog.getByText(t.amountInput.invalidExpression)).toBeVisible()
    await expectNoAxeViolations(page)
    expect(api.created).toEqual([])
  })

  test('ошибка сервера по полю — текст из словаря', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockApi(page)
    api.failCreate = (route) =>
      problem(route, 422, 'validation_failed', {
        errors: [{ field: 'categoryId', code: 'invalid_category', message: 'server' }],
      })
    const dialog = await openQuickAdd(page)
    await page.keyboard.type('590')
    await pickChip(dialog, food.name)
    await page.keyboard.press('Enter')
    await expect(dialog.getByText(t.errors.field.invalidCategory)).toBeVisible()
    // Над формой общего сообщения нет — всё сказано у поля.
    await expect(dialog.getByText(t.errors.validation)).toHaveCount(0)
  })

  test(
    'Tab-порядок: сумма → категории → комментарий → сохранить',
    { tag: '@a11y' },
    async ({ page }) => {
      await mockApi(page)
      const dialog = await openQuickAdd(page)
      // Назад от суммы — дата, счёт, вид операции.
      await page.keyboard.press('Shift+Tab')
      await expect(dialog.getByRole('button', { name: /^Дата:/ })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(dialog.getByRole('button', { name: /^Счёт:/ })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(dialog.getByRole('radio', { name: t.transactions.kinds.expense })).toBeFocused()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await expect(amountField(dialog)).toBeFocused()
      // Вперёд: кнопки знаков калькулятора в порядок Tab не входят — сразу частые категории.
      await page.keyboard.press('Tab')
      await expect(chip(dialog, food.name)).toBeFocused()
      // Через чипы — к поиску категории, комментарию и кнопке.
      const search = dialog.getByRole('combobox', { name: t.categories.picker.search, exact: true })
      for (
        let i = 0;
        i < 8 && !(await search.evaluate((el) => el === document.activeElement));
        i++
      ) {
        await page.keyboard.press('Tab')
      }
      await expect(search).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('textbox', { name: t.transactions.comment })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(
        dialog.getByRole('button', { name: t.transactions.submit.expense }),
      ).toBeFocused()
    },
  )

  test('Esc закрывает окно и возвращает фокус на кнопку', { tag: '@a11y' }, async ({ page }) => {
    await mockApi(page)
    await openHome(page)
    await navAddButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(amountField(quickAdd(page))).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(quickAdd(page)).toBeHidden()
    await expect(navAddButton(page)).toBeFocused()
  })
})

test.describe('ошибка сохранения', () => {
  async function failOnce(page: Page) {
    const api = await mockApi(page)
    api.failCreate = (route) => route.abort('internetdisconnected')
    const dialog = await openQuickAdd(page)
    await page.keyboard.type('590')
    await pickChip(dialog, food.name)
    await dialog.getByRole('textbox', { name: t.transactions.comment }).fill('Пятёрочка')
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('alert')).toContainText(t.errors.network)
    return { api, dialog }
  }

  test('скриншот', { tag: '@visual' }, async ({ page }) => {
    await failOnce(page)
    await expect(page).toHaveScreenshot('quick-add-error.png')
  })

  test('введённое на месте, «Повторить» сохраняет', { tag: '@a11y' }, async ({ page }) => {
    const { api, dialog } = await failOnce(page)
    await expectNoAxeViolations(page)
    await expect(amountField(dialog)).toHaveValue('590')
    await expect(chip(dialog, food.name)).toBeChecked()
    await dialog.getByRole('button', { name: t.errors.retry }).click()
    await expect(toast(page, /^Расход/)).toBeVisible()
    expect(api.created).toHaveLength(1)
    await expect(dialog.getByRole('alert')).toHaveCount(0)
  })

  test('ошибка отмены — тост с причиной', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockApi(page)
    api.failDelete = (route) => problem(route, 403, 'transaction_readonly')
    const dialog = await openQuickAdd(page)
    await page.keyboard.type('590')
    await pickChip(dialog, food.name)
    await page.keyboard.press('Enter')
    await toast(page, /^Расход/)
      .getByRole('button', { name: t.common.undo })
      .click()
    await expect(toast(page, t.transactions.toasts.undoFailed)).toContainText(
      t.errors.transactionReadonly,
    )
  })
})

test.describe('перевод', () => {
  async function openExchange(page: Page) {
    const api = await mockApi(page)
    const dialog = await openQuickAdd(page)
    await kindTab(dialog, 'transfer').click()
    await amountField(dialog, t.transactions.fromAmount).fill('9235')
    await amountField(dialog, t.transactions.toAmount).fill('100')
    await expect(dialog.getByText(/^Курс:/)).toBeVisible()
    return { api, dialog }
  }

  test('скриншот: обмен валют', { tag: '@visual' }, async ({ page }) => {
    await openExchange(page)
    await expect(page).toHaveScreenshot('quick-add-transfer-exchange.png')
  })

  test('обмен валют: курс, запрос и тост', { tag: '@a11y' }, async ({ page }) => {
    const { api, dialog } = await openExchange(page)
    expect(plain(await dialog.getByText(/^Курс:/).textContent())).toBe('Курс: 1 $ = 92,35 ₽')
    await expect(
      dialog.getByRole('button', { name: `${t.transactions.from}: Карта` }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: `${t.transactions.to}: Доллары` }),
    ).toBeVisible()
    await expectNoAxeViolations(page)
    await page.keyboard.press('Enter')
    await expect(toast(page, /^Перевод/)).toBeVisible()
    expect(plain(await toast(page, /^Перевод/).textContent())).toContain(
      'Перевод 9 235 ₽ · Карта → Доллары',
    )
    expect(api.created).toEqual([
      {
        kind: 'transfer',
        date: today(),
        accountId: card.id,
        toAccountId: usd.id,
        amount: 923_500,
        toAmount: 10_000,
        comment: '',
      },
    ])
    // Вид операции после сохранения остаётся.
    await expect(dialog.getByRole('radio', { name: t.transactions.kinds.transfer })).toBeChecked()
  })

  test('тот же счёт в «Куда» — счета меняются местами', { tag: '@a11y' }, async ({ page }) => {
    await mockApi(page)
    const dialog = await openQuickAdd(page)
    await kindTab(dialog, 'transfer').click()
    await dialog.getByRole('button', { name: `${t.transactions.to}: Доллары` }).click()
    const picker = page.getByRole('dialog', { name: t.transactions.to })
    await picker.getByRole('button', { name: /^Карта/ }).click()
    await expect(picker).toBeHidden()
    await expect(
      dialog.getByRole('button', { name: `${t.transactions.from}: Доллары` }),
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: `${t.transactions.to}: Карта` })).toBeVisible()
    // Валюты различаются — нужна сумма зачисления.
    await expect(amountField(dialog, t.transactions.toAmount)).toBeVisible()
  })

  test('один счёт — объяснение вместо формы', { tag: '@a11y' }, async ({ page }) => {
    await mockApi(page, { accounts: [card] })
    const dialog = await openQuickAdd(page)
    await kindTab(dialog, 'transfer').click()
    await expect(
      dialog.getByRole('heading', { name: t.transactions.transferNeedsTwo.title }),
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^Сохранить/ })).toHaveCount(0)
    await expectNoAxeViolations(page)
  })
})

test.describe('состояния', () => {
  test('нет счетов: скриншот', { tag: '@visual' }, async ({ page }) => {
    await mockApi(page, { accounts: [] })
    await openHome(page)
    await navAddButton(page).click()
    await expect(
      quickAdd(page).getByRole('heading', { name: t.transactions.noAccounts.title }),
    ).toBeVisible()
    await expect(page).toHaveScreenshot('quick-add-no-accounts.png')
  })

  test(
    'нет счетов: «Создать счёт» ведёт на «Счета» без лишнего шага в истории',
    {
      tag: '@a11y',
    },
    async ({ page }) => {
      await mockApi(page, { accounts: [] })
      await openHome(page, '/reports')
      await page
        .getByRole('navigation', { name: t.nav.label })
        .getByRole('link', { name: t.nav.home })
        .click()
      await expect(page).toHaveURL(/\/$/)
      await navAddButton(page).click()
      const dialog = quickAdd(page)
      await expect(
        dialog.getByRole('heading', { name: t.transactions.noAccounts.title }),
      ).toBeVisible()
      await expectNoAxeViolations(page)
      await dialog.getByRole('button', { name: t.transactions.noAccounts.action }).click()
      await expect(page).toHaveURL(/\/accounts$/)
      await expect(dialog).toBeHidden()
      // «Назад» — на экран, где открыли окно, и дальше — на предыдущий: «пустой» записи
      // окна в истории нет.
      await page.goBack()
      await expect(page).toHaveURL(/\/$/)
      await page.goBack()
      await expect(page).toHaveURL(/\/reports$/)
    },
  )

  test('загрузка: скелетон, затем форма с фокусом в сумме', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockApi(page)
    api.defaultsDelay = 1500
    await openHome(page)
    await navAddButton(page).click()
    const dialog = quickAdd(page)
    await expect(dialog.getByRole('status')).toBeVisible()
    await expectNoAxeViolations(page)
    await expect(amountField(dialog)).toBeFocused({ timeout: 5000 })
    await expect(dialog.getByRole('status')).toHaveCount(0)
  })

  test(
    'длинные названия и огромная сумма не ломают вёрстку',
    { tag: '@a11y' },
    async ({ page }) => {
      const long = {
        ...card,
        name: 'Накопительный счёт на отпуск в следующем году — не трогать до лета',
        balance: 99_999_999_999_99,
        baseBalance: 99_999_999_999_99,
      }
      const longCategory = category(
        9,
        'Образование детей: кружки, секции, репетиторы и летние лагеря в другом городе',
      )
      await mockApi(page, {
        accounts: [long, cash],
        categories: [longCategory, ...categories],
        defaults: {
          ...defaults,
          expenseAccountId: long.id,
          frequentCategories: { expense: [longCategory.id, food.id], income: [] },
        },
      })
      const dialog = await openQuickAdd(page)
      await page.keyboard.type('99999999999,99*1')
      await expect(dialog.getByText(/^=/)).toBeVisible()
      expect(await horizontalOverflow(page)).toBe(0)
      await expectNoAxeViolations(page)
      // Больше предела — понятная ошибка, а не 422 от сервера.
      await amountField(dialog).fill('100000000000,01')
      await pickChip(dialog, food.name)
      await page.keyboard.press('Enter')
      await expect(dialog.getByText(t.moneyInput.tooLarge)).toBeVisible()
    },
  )

  test(
    'поиск категории в окне не зацикливает ResizeObserver',
    { tag: '@a11y' },
    async ({ page }) => {
      const errors = await collectWindowErrors(page)
      await mockApi(page)
      const dialog = await openQuickAdd(page)
      const search = dialog.getByRole('combobox', { name: t.categories.picker.search, exact: true })
      await search.click()
      await search.pressSequentially('так')
      await page.getByRole('option', { name: /Такси/ }).click()
      await expect(chip(dialog, taxiLabel)).toBeChecked()
      await search.click()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Escape')
      // Esc закрыл список, а не окно.
      await expect(dialog).toBeVisible()
      expect((await errors()).filter((e) => /ResizeObserver/.test(e))).toEqual([])
    },
  )
})

test.describe('кнопки знаков калькулятора', () => {
  test.skip(({ isMobile }) => !isMobile, 'Ряд кнопок — только в мобильной раскладке')

  test(
    'вставляют знак в позицию курсора, фокус остаётся в сумме',
    { tag: '@a11y' },
    async ({ page }) => {
      await mockApi(page)
      const dialog = await openQuickAdd(page)
      const operators = dialog.getByRole('group', { name: t.amountInput.operatorsLabel })
      const toggle = dialog.getByRole('button', { name: t.amountInput.calculator })
      // Ряд скрыт, пока его не открыли кнопкой в поле.
      await expect(operators).toHaveCount(0)
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await page.keyboard.type('350')
      await toggle.tap()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await expect(amountField(dialog)).toBeFocused()
      await operators.getByRole('button', { name: t.amountInput.operators.plus }).tap()
      await page.keyboard.type('120')
      await operators.getByRole('button', { name: t.amountInput.operators.times }).tap()
      await page.keyboard.type('2')
      await expect(amountField(dialog)).toHaveValue('350+120×2')
      await expect(amountField(dialog)).toBeFocused()
      await expect(dialog.getByText(/^=/)).toHaveText(/= 590\s₽/)
      // Зоны касания не меньше 44 px.
      for (const box of await operators
        .getByRole('button')
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))) {
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.width).toBeGreaterThanOrEqual(44)
      }
      // Открытый ряд остаётся открытым и после сохранения.
      await pickChip(dialog, food.name)
      await page.keyboard.press('Enter')
      await expect(toast(page, /^Расход/)).toBeVisible()
      await expect(operators).toBeVisible()
    },
  )
})

test.describe('раскладка на телефоне: «≤ 3 касаний» не мешает клавиатура', () => {
  test.skip(({ isMobile }) => !isMobile, 'Раскладка телефона')

  test(
    '375×360 (клавиатура поднята): первый чип целиком виден при фокусе в сумме',
    { tag: '@a11y' },
    async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 360 })
      await mockApi(page)
      const dialog = await openQuickAdd(page)
      await page.keyboard.type('350+120*2')
      const box = (await chip(dialog, food.name).locator('..').boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(360)
      expect(box.height).toBeGreaterThanOrEqual(44)
      // И ничем не закрыт (например, закреплённой кнопкой «Сохранить»).
      const hit = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.textContent ?? '',
        [box.x + box.width / 2, box.y + box.height / 2],
      )
      expect(hit).toBe(food.name)
      expect(await horizontalOverflow(page)).toBe(0)
    },
  )

  test('375×667: «Сохранить» видна без прокрутки', { tag: '@a11y' }, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await mockApi(page)
    const dialog = await openQuickAdd(page)
    await page.keyboard.type('350+120*2')
    const submit = dialog.getByRole('button', { name: t.transactions.submit.expense })
    const box = (await submit.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(667)
    // И после выбора чипа — тоже (кнопка закреплена внизу окна).
    await pickChip(dialog, food.name)
    const after = (await submit.boundingBox())!
    expect(after.y + after.height).toBeLessThanOrEqual(667)
  })

  test('частые категории — две строки с прокруткой вбок', { tag: '@a11y' }, async ({ page }) => {
    const extra = Array.from({ length: 6 }, (_, i) => category(20 + i, `Категория ${i + 1}`))
    await mockApi(page, {
      categories: [...categories, ...extra],
      defaults: {
        ...defaults,
        frequentCategories: {
          expense: [food.id, taxi.id, cafe.id, health.id, ...extra.map((c) => c.id)].slice(0, 8),
          income: [],
        },
      },
    })
    const dialog = await openQuickAdd(page)
    const group = dialog.getByRole('group', { name: t.categories.picker.frequent })
    const tops = await group
      .getByRole('radio')
      .evaluateAll((els) => els.map((el) => el.parentElement!.getBoundingClientRect().top))
    expect(new Set(tops.map(Math.round)).size).toBe(2)
    // Прокрутка вбок, а не горизонтальный скролл страницы.
    expect(await horizontalOverflow(page)).toBe(0)
    // С клавиатуры последний чип достижим и прокручивается в видимую область.
    const last = chip(dialog, 'Категория 4')
    await last.focus()
    await page.keyboard.press('Space')
    await expect(last).toBeChecked()
    await expect(last.locator('..')).toBeInViewport()
    await expectNoAxeViolations(page)
  })
})

test.describe('«Назад» закрывает окно', () => {
  /** Главная → «Операции» (запись в истории), там — быстрый ввод. */
  async function openFromTransactions(page: Page) {
    await mockApi(page)
    await openHome(page)
    await page
      .getByRole('navigation', { name: t.nav.label })
      .getByRole('link', { name: t.nav.transactions })
      .click()
    await expect(page).toHaveURL(/\/transactions$/)
    await navAddButton(page).click()
    await expect(amountField(quickAdd(page))).toBeFocused()
  }

  test(
    '«Назад» закрывает, следующий «Назад» — на прежний экран',
    { tag: '@a11y' },
    async ({ page }) => {
      await openFromTransactions(page)
      await page.goBack()
      await expect(quickAdd(page)).toBeHidden()
      await expect(page).toHaveURL(/\/transactions$/)
      await page.goBack()
      await expect(page).toHaveURL(/\/$/)
    },
  )

  test('закрытие по Esc не оставляет «пустого» шага', { tag: '@a11y' }, async ({ page }) => {
    await openFromTransactions(page)
    await page.keyboard.press('Escape')
    await expect(quickAdd(page)).toBeHidden()
    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
  })

  test(
    'после сохранения окно открыто, «Назад» его закрывает',
    { tag: '@a11y' },
    async ({ page }) => {
      await openFromTransactions(page)
      const dialog = quickAdd(page)
      await page.keyboard.type('590')
      await pickChip(dialog, food.name)
      await page.keyboard.press('Enter')
      await expect(toast(page, /^Расход/)).toBeVisible()
      await page.goBack()
      await expect(dialog).toBeHidden()
      await expect(page).toHaveURL(/\/transactions$/)
    },
  )

  test('вложенное окно выбора счёта закрывается первым', { tag: '@a11y' }, async ({ page }) => {
    await openFromTransactions(page)
    const dialog = quickAdd(page)
    await dialog.getByRole('button', { name: /^Счёт:/ }).click()
    const picker = page.getByRole('dialog', { name: t.transactions.account })
    await expect(picker).toBeVisible()
    await page.goBack()
    await expect(picker).toBeHidden()
    await expect(dialog).toBeVisible()
    await page.goBack()
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(/\/transactions$/)

    // Выбор в окне счёта закрывает его и убирает его запись: «Назад» закрывает быстрый ввод.
    await navAddButton(page).click()
    await dialog.getByRole('button', { name: /^Счёт:/ }).click()
    await picker.getByRole('button', { name: /^Наличные/ }).click()
    await expect(picker).toBeHidden()
    await expect(dialog.getByRole('button', { name: 'Счёт: Наличные' })).toBeVisible()
    await page.goBack()
    await expect(dialog).toBeHidden()
    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
  })

  test(
    'после перезагрузки страницы «Назад» закрывает новое окно',
    { tag: '@a11y' },
    async ({ page }) => {
      await openFromTransactions(page)
      // Перезагрузка с открытым окном: в history.state осталась метка прежнего окна.
      await page.reload()
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await navAddButton(page).click()
      await expect(amountField(quickAdd(page))).toBeFocused()
      await page.goBack()
      await expect(quickAdd(page)).toBeHidden()
    },
  )

  test(
    'замена адреса изнутри окна (replace) не оставляет лишнего шага',
    { tag: '@a11y' },
    async ({ page }) => {
      await mockApi(page)
      await openHome(page, '/settings')
      await page
        .getByRole('main')
        .getByRole('link', { name: new RegExp(t.categories.title) })
        .click()
      await expect(page.getByRole('heading', { level: 1, name: t.categories.title })).toBeVisible()
      await page.getByRole('button', { name: t.categories.add }).first().click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      // Вкладка под окном переключается с replace: true — так же лента меняет фильтры
      // в открытом окне. Щелчок из кода: подложка окна перехватила бы настоящий.
      await page
        .getByRole('tab', { name: t.categories.kinds.income })
        .evaluate((el) => (el as HTMLElement).click())
      await expect(page).toHaveURL(/kind=income/)
      await dialog.getByRole('button', { name: t.common.close }).click()
      await expect(dialog).toBeHidden()
      // Адрес, сменённый в окне, сохранился, а «Назад» уводит на прежний экран.
      await expect(page).toHaveURL(/\/settings\/categories\?kind=income$/)
      await page.goBack()
      await expect(page).toHaveURL(/\/settings$/)
    },
  )

  test('окна «Счетов» и «Категорий»', { tag: '@a11y' }, async ({ page }) => {
    await mockApi(page)
    await page.route(`**${API}/categories`, (route) =>
      route.fulfill({ json: { items: categories } }),
    )
    await openHome(page, '/accounts')
    await page.getByRole('button', { name: t.accounts.create }).first().click()
    const create = page.getByRole('dialog', { name: t.accounts.form.createTitle })
    await expect(create).toBeVisible()
    await page.goBack()
    await expect(create).toBeHidden()
    await expect(page).toHaveURL(/\/accounts$/)

    await page.goto('/settings/categories')
    await expect(page.getByRole('heading', { level: 1, name: t.categories.title })).toBeVisible()
    await page.getByRole('button', { name: t.categories.add }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/settings\/categories$/)
  })
})
