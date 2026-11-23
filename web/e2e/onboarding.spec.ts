import { expect, test, type Page, type Route } from '@playwright/test'

import { ru as t } from '../src/shared/i18n/ru.ts'
import {
  API,
  enlargeFont,
  existingAccount,
  expectNoAxeViolations,
  fontsReady,
  horizontalOverflow,
  mockSignedIn,
  problem,
} from './support.ts'

// Онбординг на главной: у пользователя нет ни одного счёта → шаг 1 (первый счёт),
// после создания → шаг 2 (где вносить операции). Регистрация не нужна: вошедший
// пользователь с пустым списком счетов. API подменяется через page.route.

const currencies = {
  items: [
    { code: 'RUB', name: 'Российский рубль', symbol: '₽', minorUnits: 2 },
    { code: 'USD', name: 'Доллар США', symbol: '$', minorUnits: 2 },
  ],
}

type MockApi = {
  accounts: Record<string, unknown>[]
  /** Тела запросов `POST /accounts`. */
  created: Record<string, unknown>[]
  /** Ответить на следующий `POST /accounts` этим обработчиком вместо обычного. */
  failCreate: ((route: Route) => Promise<void>) | null
}

/** Счета: список (по умолчанию пустой) и создание. */
async function mockAccounts(page: Page): Promise<MockApi> {
  const api: MockApi = { accounts: [], created: [], failCreate: null }
  await page.route(`**${API}/currencies`, (route) => route.fulfill({ json: currencies }))
  await page.route(`**${API}/accounts`, async (route) => {
    const request = route.request()
    if (request.method() === 'GET') return route.fulfill({ json: { items: api.accounts } })
    if (request.method() !== 'POST') return problem(route, 404, 'not_found')
    if (api.failCreate) {
      const fail = api.failCreate
      api.failCreate = null
      return fail(route)
    }
    const body = request.postDataJSON()
    api.created.push(body)
    const account = {
      ...existingAccount,
      ...body,
      id: '01a1faf8-0000-7000-8000-0000000000b1',
      balance: body.initialBalance,
    }
    api.accounts.push(account)
    return route.fulfill({ status: 201, json: account })
  })
  return api
}

test.beforeEach(async ({ page }) => {
  await mockSignedIn(page)
})

async function openStep1(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: t.onboarding.title })).toBeVisible()
  await fontsReady(page)
}

const nameField = (page: Page) => page.getByLabel(t.accounts.form.name)
const typeField = (page: Page) => page.getByLabel(t.accounts.form.type)
const balanceField = (page: Page) => page.getByLabel(t.accounts.form.initialBalance)
const chip = (page: Page, label: string) => page.getByRole('radio', { name: label, exact: true })
const intro = (page: Page) => page.getByRole('region', { name: t.onboarding.introTitle })
/** Нажать чип: сам input у Mantine скрыт, нажимаем на его подпись (как пользователь). */
const pickChip = (page: Page, label: string) => chip(page, label).locator('..').click()

/** Кнопка добавления операции из навигации: «+» на mobile, кнопка в боковом меню на desktop. */
const navAddButton = (page: Page) =>
  page
    .getByRole('navigation', { name: t.nav.label })
    .getByRole('button', { name: t.nav.addTransaction })

/** Шаг 1 → шаг 2: чип «Карта», остаток, «Создать счёт». */
async function createFirstAccount(page: Page) {
  await pickChip(page, t.onboarding.presets.card)
  await balanceField(page).fill('12 500')
  await page.getByRole('button', { name: t.accounts.form.submitCreate }).click()
  await expect(intro(page)).toBeVisible()
  await fontsReady(page)
}

test.describe('шаг 1: первый счёт', () => {
  test('скриншот', { tag: '@visual' }, async ({ page }) => {
    await mockAccounts(page)
    await openStep1(page)
    await expect(page).toHaveScreenshot('onboarding-step1.png', { fullPage: true })
  })

  test('скриншот при шрифте 200 %', { tag: '@visual' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Крупный шрифт важен на узком экране')
    await mockAccounts(page)
    await openStep1(page)
    await enlargeFont(page)
    await expect(page).toHaveScreenshot('onboarding-step1-font-200.png', { fullPage: true })
  })

  test('доступность и вёрстка', { tag: '@a11y' }, async ({ page }) => {
    await mockAccounts(page)
    await openStep1(page)
    await expectNoAxeViolations(page)
    expect(await horizontalOverflow(page)).toBe(0)

    // Длинное название не ломает вёрстку.
    await nameField(page).fill(
      'Накопительный счёт на отпуск в следующем году — не трогать'.repeat(2),
    )
    expect(await horizontalOverflow(page)).toBe(0)

    // «Ещё настройки» раскрывают видимость, «учитывать в балансе» и цвет.
    const more = page.getByRole('button', { name: t.accounts.form.moreSettings })
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText(t.accounts.form.visibility)).toHaveCount(0)
    await more.click()
    await expect(more).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('radio', { name: t.accounts.form.visibilityShared })).toBeChecked()
    await expect(page.getByLabel(t.accounts.form.includeInTotal)).toBeChecked()
    await expectNoAxeViolations(page)
  })

  test('шрифт 200 %: нет горизонтального скролла', { tag: '@a11y' }, async ({ page }) => {
    await mockAccounts(page)
    await openStep1(page)
    await enlargeFont(page)
    expect(await horizontalOverflow(page)).toBe(0)
  })

  test(
    'чип заполняет название и тип, правка названия снимает выбор',
    { tag: '@a11y' },
    async ({ page }) => {
      await mockAccounts(page)
      await openStep1(page)
      await pickChip(page, t.onboarding.presets.cash)
      await expect(nameField(page)).toHaveValue(t.onboarding.presets.cash)
      await expect(typeField(page)).toHaveValue('cash')
      await expect(chip(page, t.onboarding.presets.cash)).toBeChecked()

      await pickChip(page, t.onboarding.presets.creditCard)
      await expect(nameField(page)).toHaveValue(t.onboarding.presets.creditCard)
      await expect(typeField(page)).toHaveValue('credit_card')
      await expect(chip(page, t.onboarding.presets.cash)).not.toBeChecked()

      await nameField(page).fill('Кредитка Тинькофф')
      await expect(chip(page, t.onboarding.presets.creditCard)).not.toBeChecked()
      await expect(typeField(page)).toHaveValue('credit_card')
    },
  )

  test('ошибка создания: сообщение, введённое не теряется', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockAccounts(page)
    await openStep1(page)
    api.failCreate = (route) => route.abort('internetdisconnected')
    await pickChip(page, t.onboarding.presets.card)
    await balanceField(page).fill('12 500')
    await page.getByRole('button', { name: t.accounts.form.submitCreate }).click()

    const alert = page.getByRole('alert')
    await expect(alert).toContainText(t.errors.network)
    await expect(nameField(page)).toHaveValue(t.onboarding.presets.card)
    await expect(balanceField(page)).toHaveValue('12 500')
    await expectNoAxeViolations(page)

    // «Повторить» отправляет ту же форму.
    await alert.getByRole('button', { name: t.errors.retry }).click()
    await expect(intro(page)).toBeVisible()
    expect(api.created).toHaveLength(1)
  })

  test('ошибка загрузки списка счетов: «Повторить»', { tag: '@a11y' }, async ({ page }) => {
    const api = await mockAccounts(page)
    let fail = true
    await page.route(`**${API}/accounts`, (route) => {
      if (route.request().method() === 'GET' && fail) return problem(route, 500, 'internal')
      return route.fallback()
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 2, name: t.accounts.loadError })).toBeVisible()
    // Пока ошибка — онбординга нет: неизвестно, есть ли у пользователя счета.
    await expect(page.getByRole('heading', { name: t.onboarding.title })).toHaveCount(0)
    await expectNoAxeViolations(page)

    fail = false
    await page.getByRole('button', { name: t.errors.retry }).click()
    await expect(page.getByRole('heading', { level: 1, name: t.onboarding.title })).toBeVisible()
    expect(api.created).toHaveLength(0)
  })
})

test.describe('шаг 2: где вносить операции', () => {
  test('скриншот', { tag: '@visual' }, async ({ page }) => {
    await mockAccounts(page)
    await openStep1(page)
    await createFirstAccount(page)
    await expect(page).toHaveScreenshot('onboarding-step2.png')
  })

  test('доступность', { tag: '@a11y' }, async ({ page }) => {
    await mockAccounts(page)
    await openStep1(page)
    await createFirstAccount(page)
    await expectNoAxeViolations(page)
    expect(await horizontalOverflow(page)).toBe(0)
  })

  test(
    'создание → шаг 2 → быстрый ввод → «Понятно»',
    { tag: '@a11y' },
    async ({ page, isMobile }) => {
      const api = await mockAccounts(page)
      await openStep1(page)
      await expect(navAddButton(page)).not.toHaveAttribute('data-highlight')
      await createFirstAccount(page)

      // Запрос: название и тип из чипа, умные значения по умолчанию для остального.
      expect(api.created).toEqual([
        {
          name: t.onboarding.presets.card,
          type: 'card',
          currency: 'RUB',
          initialBalance: 1_250_000,
          visibility: 'shared',
          includeInTotal: true,
          color: null,
        },
      ])

      // Фокус на карточке: диктор прочитает результат. Текст — под раскладку.
      await expect(intro(page)).toBeFocused()
      await expect(intro(page)).toContainText(
        isMobile ? t.onboarding.introHintMobile : t.onboarding.introHintDesktop,
      )
      // Кнопка быстрого ввода в оболочке выделена, пока видна карточка.
      await expect(navAddButton(page)).toHaveAttribute('data-highlight', 'true')
      // Тоста нет: карточка сама говорит «Готово».
      await expect(page.locator('.mantine-Notification-root')).toHaveCount(0)

      const addFirst = intro(page).getByRole('button', { name: t.onboarding.addFirst })
      await addFirst.click()
      const dialog = page.getByRole('dialog', { name: t.quickAdd.title })
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(addFirst).toBeFocused()

      await intro(page).getByRole('button', { name: t.onboarding.dismiss }).click()
      await expect(intro(page)).toHaveCount(0)
      await expect(navAddButton(page)).not.toHaveAttribute('data-highlight')
      // Обычная главная: шаг 1 не возвращается — счёт уже есть. Фокус — на её главном действии.
      await expect(page.getByRole('heading', { level: 1, name: t.nav.home })).toBeVisible()
      await expect(page.getByRole('heading', { name: t.onboarding.title })).toHaveCount(0)
      await expect(
        page.getByRole('main').getByRole('button', { name: t.nav.addTransaction }),
      ).toBeFocused()
    },
  )

  test('уход с главной скрывает шаг 2', { tag: '@a11y' }, async ({ page }) => {
    await mockAccounts(page)
    await openStep1(page)
    await createFirstAccount(page)
    // Переход внутри приложения, без перезагрузки: состояние в памяти не теряется само.
    const nav = page.getByRole('navigation', { name: t.nav.label })
    await nav.getByRole('link', { name: t.nav.reports }).click()
    await expect(page.getByRole('heading', { level: 1, name: t.nav.reports })).toBeVisible()
    await expect(navAddButton(page)).not.toHaveAttribute('data-highlight')
    await nav.getByRole('link', { name: t.nav.home }).click()
    await expect(page.getByRole('heading', { level: 1, name: t.nav.home })).toBeVisible()
    await expect(intro(page)).toHaveCount(0)
  })
})

test('есть счёт — онбординга нет', { tag: '@a11y' }, async ({ page }) => {
  // mockSignedIn отдаёт один счёт.
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: t.nav.home })).toBeVisible()
  await expect(page.getByRole('heading', { name: t.onboarding.title })).toHaveCount(0)
  await expect(navAddButton(page)).not.toHaveAttribute('data-highlight')
})
