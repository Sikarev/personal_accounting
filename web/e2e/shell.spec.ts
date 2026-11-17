import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Тексты берём из словаря: тест не ломается от правки формулировки.
import { ru as t } from '../src/shared/i18n/ru.ts'

// Оболочка приложения: главная, открытый быстрый ввод, экран «Ещё».
// Проекты (mobile/desktop × light/dark) заданы в playwright.config.ts.

async function openPage(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // Скриншот до загрузки Inter дал бы системный шрифт и нестабильный эталон.
  await page.evaluate(() => document.fonts.ready)
}

/** Кнопка добавления операции из навигации: «+» на mobile, кнопка в боковом меню на desktop. */
function addButton(page: Page) {
  return page
    .getByRole('navigation', { name: t.nav.label })
    .getByRole('button', { name: t.nav.addTransaction })
}

async function openQuickAdd(page: Page) {
  await addButton(page).click()
  const dialog = page.getByRole('dialog', { name: t.quickAdd.title })
  await expect(dialog).toBeVisible()
  return dialog
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze()
  // Список нарушений в сообщении об ошибке понятнее, чем «expected 2 to be 0».
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join('; ')})`,
    ),
  ).toEqual([])
}

test.describe('главная', () => {
  test('скриншот', { tag: '@visual' }, async ({ page }) => {
    await openPage(page, '/')
    await expect(page).toHaveScreenshot('home.png')
  })

  test('доступность', { tag: '@a11y' }, async ({ page }) => {
    await openPage(page, '/')
    await expectNoAxeViolations(page)
  })

  test('нет горизонтального скролла', { tag: '@a11y' }, async ({ page }) => {
    await openPage(page, '/')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBe(0)
  })

  test(
    'навигация показывает нужный вариант под ширину',
    { tag: '@a11y' },
    async ({ page, isMobile }) => {
      await openPage(page, '/')
      const nav = page.getByRole('navigation', { name: t.nav.label })
      // В каждой ширине ровно одна видимая основная навигация.
      await expect(nav).toHaveCount(1)
      if (isMobile) {
        await expect(nav.getByRole('link', { name: t.nav.more })).toBeVisible()
        await expect(nav.getByRole('link', { name: t.nav.accounts })).toHaveCount(0)
      } else {
        await expect(nav.getByRole('link', { name: t.nav.accounts })).toBeVisible()
        await expect(nav.getByRole('link', { name: t.nav.more })).toHaveCount(0)
      }
      await expect(nav.getByRole('link', { name: t.nav.home })).toHaveAttribute(
        'aria-current',
        'page',
      )
    },
  )
})

test.describe('быстрый ввод', () => {
  test('скриншот открытой панели', { tag: '@visual' }, async ({ page }) => {
    await openPage(page, '/')
    await openQuickAdd(page)
    await expect(page).toHaveScreenshot('quick-add.png')
  })

  test('доступность открытой панели', { tag: '@a11y' }, async ({ page }) => {
    await openPage(page, '/')
    await openQuickAdd(page)
    await expectNoAxeViolations(page)
  })

  test('Esc закрывает панель и возвращает фокус на кнопку', { tag: '@a11y' }, async ({ page }) => {
    await openPage(page, '/')
    const trigger = addButton(page)
    // Открываем с клавиатуры — так проверяется и видимость кнопки в порядке табуляции.
    await trigger.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: t.quickAdd.title })
    await expect(dialog).toBeVisible()
    // Фокус внутри окна, а не на странице под ним.
    await expect(dialog.locator(':focus')).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('кнопка «Закрыть» подписана и закрывает панель', { tag: '@a11y' }, async ({ page }) => {
    await openPage(page, '/')
    const dialog = await openQuickAdd(page)
    await dialog.getByRole('button', { name: t.common.close }).click()
    await expect(dialog).toBeHidden()
  })
})

test.describe('mobile: нижняя панель и экран «Ещё»', () => {
  test.skip(({ isMobile }) => !isMobile, 'Нижняя панель и «Ещё» есть только на mobile')

  async function openMore(page: Page) {
    await openPage(page, '/')
    await page
      .getByRole('navigation', { name: t.nav.label })
      .getByRole('link', { name: t.nav.more })
      .click()
    await expect(page.getByRole('heading', { level: 1, name: t.nav.more })).toBeVisible()
  }

  test('скриншот', { tag: '@visual' }, async ({ page }) => {
    await openMore(page)
    await expect(page).toHaveScreenshot('more.png')
  })

  test('доступность и ссылки на разделы', { tag: '@a11y' }, async ({ page }) => {
    await openMore(page)
    await expectNoAxeViolations(page)

    const main = page.getByRole('main')
    await main.getByRole('link', { name: new RegExp(t.nav.accounts) }).click()
    await expect(page.getByRole('heading', { level: 1, name: t.nav.accounts })).toBeVisible()
    // Пока открыт раздел из «Ещё», в панели подсвечен пункт «Ещё».
    await expect(
      page.getByRole('navigation', { name: t.nav.label }).getByRole('link', { name: t.nav.more }),
    ).toHaveAttribute('aria-current', 'page')
  })

  test('зоны касания нижней панели не меньше 44 px', { tag: '@a11y' }, async ({ page }) => {
    await openPage(page, '/')
    const nav = page.getByRole('navigation', { name: t.nav.label })
    const targets = [
      ...(await nav.getByRole('link').all()),
      ...(await nav.getByRole('button').all()),
    ]
    expect(targets).toHaveLength(5)
    for (const target of targets) {
      const box = await target.boundingBox()
      expect(box?.width).toBeGreaterThanOrEqual(44)
      expect(box?.height).toBeGreaterThanOrEqual(44)
    }
  })
})
