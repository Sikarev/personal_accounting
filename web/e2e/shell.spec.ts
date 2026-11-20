import { expect, test, type Page } from '@playwright/test'

// Тексты берём из словаря: тест не ломается от правки формулировки.
import { ru as t } from '../src/shared/i18n/ru.ts'
import {
  enlargeFont,
  expectNoAxeViolations,
  fontsReady,
  horizontalOverflow,
  mockSignedIn,
} from './support.ts'

// Оболочка приложения: главная, открытый быстрый ввод, экран «Ещё».
// Проекты (mobile/desktop × light/dark) заданы в playwright.config.ts.

// Оболочка — только для вошедшего пользователя: подменяем /me (e-mail подтверждён,
// плашки нет — она проверяется в auth.spec.ts).
test.beforeEach(async ({ page }) => {
  await mockSignedIn(page)
})

async function openPage(page: Page, path: string) {
  await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // Скриншот до загрузки Inter дал бы системный шрифт и нестабильный эталон.
  await fontsReady(page)
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
    expect(await horizontalOverflow(page)).toBe(0)
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

  test('скриншот с фокусом на пункте списка', { tag: '@visual' }, async ({ page }) => {
    await openPage(page, '/more')
    // Первый Tab — на первую ссылку списка: кольцо фокуса не должно обрезаться краем карточки.
    await page.keyboard.press('Tab')
    await expect(page.getByRole('main').getByRole('link').first()).toBeFocused()
    await expect(page).toHaveScreenshot('more-focus.png')
  })

  for (const path of ['/', '/more']) {
    test(
      `шрифт 200 %: нет горизонтального скролла (${path})`,
      { tag: '@a11y' },
      async ({ page }) => {
        await openPage(page, path)
        await enlargeFont(page)
        expect(await horizontalOverflow(page)).toBe(0)
        // Нижняя панель целиком в пределах экрана.
        const box = await page.getByRole('navigation', { name: t.nav.label }).boundingBox()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
      },
    )
  }

  test('скриншот главной при шрифте 200 %', { tag: '@visual' }, async ({ page }) => {
    await openPage(page, '/')
    await enlargeFont(page)
    await expect(page).toHaveScreenshot('home-font-200.png')
  })

  test(
    'поворот телефона с открытым быстрым вводом: раскладка мобильная, содержимое не пересоздаётся',
    // Ориентация — WCAG 1.3.4; тест от ОС не зависит, поэтому идёт в CI вместе с a11y.
    { tag: '@a11y' },
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await openPage(page, '/')
      const dialog = await openQuickAdd(page)
      const heading = dialog.getByRole('heading', { level: 3 })
      // Метка на DOM-узле: если содержимое пересоздастся, новый узел её не получит.
      await heading.evaluate((el) => {
        ;(el as HTMLElement & { marker?: string }).marker = 'kept'
      })

      await page.setViewportSize({ width: 844, height: 390 })

      await expect(dialog).toBeVisible()
      await expect(page.locator('.mantine-Drawer-content')).toBeVisible()
      expect(await heading.evaluate((el) => (el as HTMLElement & { marker?: string }).marker)).toBe(
        'kept',
      )

      // После закрытия — нижняя панель, а не боковое меню: телефон в альбомной ориентации.
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      const nav = page.getByRole('navigation', { name: t.nav.label })
      await expect(nav).toHaveCount(1)
      await expect(nav.getByRole('link', { name: t.nav.more })).toBeVisible()
      await expect(nav.getByRole('link', { name: t.nav.accounts })).toHaveCount(0)
    },
  )

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
