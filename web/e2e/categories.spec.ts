import { expect, test, type Page, type Request } from '@playwright/test'

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

// «Настройки» и «Настройки → Категории»: меню, дерево с подкатегориями и архивом, вкладки,
// окна, перетаскивание (мышь, клавиатура, касание), «Переместить в…», архив с отменой.
// API подменяется через page.route: под `vite preview` бэкенда нет.

/** Категория в формате API (схема `Category` контракта; своя копия — см. support.ts). */
type Category = {
  id: string
  kind: 'expense' | 'income'
  parentId: string | null
  name: string
  sortOrder: number
  archivedAt: string | null
}

const ARCHIVED_AT = '2026-11-01T09:00:00Z'
let seq = 0
function cat(
  name: string,
  options: Partial<Omit<Category, 'id' | 'name'>> & { id?: string } = {},
): Category {
  seq += 1
  return {
    id: options.id ?? `0193a000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    kind: 'expense',
    parentId: null,
    name,
    sortOrder: seq,
    archivedAt: null,
    ...options,
  }
}

const products = cat('Продукты', { sortOrder: 1 })
const dairy = cat('Молочное', { parentId: products.id, sortOrder: 1 })
const veggies = cat('Овощи и фрукты', { parentId: products.id, sortOrder: 2 })
const cafe = cat('Кафе и рестораны', { sortOrder: 2 })
const transport = cat('Транспорт', { sortOrder: 3 })
const taxi = cat('Такси', { parentId: transport.id, sortOrder: 1 })
const carsharing = cat('Каршеринг', {
  parentId: transport.id,
  sortOrder: 2,
  archivedAt: ARCHIVED_AT,
})
const metro = cat('Метро', { parentId: transport.id, sortOrder: 3 })
const longName = cat(
  'Образование детей: кружки, секции, репетиторы и летние лагеря в другом городе',
  { sortOrder: 4 },
)
const hobby = cat('Хобби', { sortOrder: 5, archivedAt: ARCHIVED_AT })
const fishing = cat('Рыбалка', { parentId: hobby.id, sortOrder: 1, archivedAt: ARCHIVED_AT })
const gifts = cat('Подарки', { sortOrder: 6 })
const salary = cat('Зарплата', { kind: 'income', sortOrder: 1 })
const sideJob = cat('Подработка', { kind: 'income', sortOrder: 2 })
const interest = cat('Проценты по вкладам', { kind: 'income', sortOrder: 3 })

const fixture: Category[] = [
  products,
  dairy,
  veggies,
  cafe,
  transport,
  taxi,
  carsharing,
  metro,
  longName,
  hobby,
  fishing,
  gifts,
  salary,
  sideJob,
  interest,
]

/**
 * Упрощённый сервер категорий в памяти: `GET` отдаёт текущее состояние, `move` / `archive` /
 * `unarchive` / создание меняют его (экран после каждого изменения перезапрашивает список —
 * без состояния ответ затёр бы оптимистичное обновление). Запросы изменений — в `writes`.
 */
async function mockCategories(page: Page, initial: Category[] = fixture) {
  let items = initial.map((c) => ({ ...c }))
  const writes: Request[] = []
  const siblings = (c: Category, parentId: string | null) =>
    items
      .filter((s) => s.kind === c.kind && s.parentId === parentId && s.id !== c.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)

  await page.route(`**${API}/categories**`, async (route) => {
    const request = route.request()
    if (request.method() === 'GET') return route.fulfill({ json: { items } })
    writes.push(request)
    const [, id, action] =
      new URL(request.url()).pathname.match(/categories\/([^/]+)\/?(\w*)/) ?? []
    const target = items.find((c) => c.id === id)
    // Тело — по контракту соответствующей операции; поля разбираются ниже по месту.
    const body = (request.postDataJSON() ?? {}) as {
      name: string
      kind: Category['kind']
      parentId: string | null
      index: number
    }

    if (!id && request.method() === 'POST') {
      const created = cat(body.name, { kind: body.kind, parentId: body.parentId ?? null })
      items.push(created)
      return route.fulfill({ status: 201, json: created })
    }
    if (!target) return problem(route, 404, 'not_found')
    if (action === 'merge') {
      items = items.filter((c) => c.id !== id && c.parentId !== id)
      return route.fulfill({ status: 204 })
    }
    if (action === 'move') {
      const { parentId, index } = body
      siblings(target, target.parentId).forEach((s, i) => (s.sortOrder = i + 1))
      const next = siblings(target, parentId)
      next.splice(index, 0, target)
      target.parentId = parentId
      next.forEach((s, i) => (s.sortOrder = i + 1))
    }
    if (action === 'archive') {
      const at = new Date().toISOString()
      for (const c of items) {
        if ((c.id === id || c.parentId === id) && c.archivedAt === null) c.archivedAt = at
      }
    }
    if (action === 'unarchive') {
      const at = target.archivedAt
      for (const c of items) {
        if (c.id === id || (c.parentId === id && c.archivedAt === at) || c.id === target.parentId)
          c.archivedAt = null
      }
    }
    if (!action && body.name) target.name = body.name
    return route.fulfill({ json: target })
  })
  return writes
}

async function ready(page: Page, heading: string) {
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
  await fontsReady(page)
}

async function openCategories(page: Page, query = '') {
  await page.goto(`/settings/categories${query}`)
  await ready(page, t.categories.title)
  await expect(page.getByRole('list', { name: /Категории/ })).toBeVisible()
}

async function expandArchive(page: Page, count: number) {
  await page.getByRole('button', { name: t.categories.archiveTitle(count) }).click()
  // Указатель — в сторону: иначе на скриншоте кнопка в состоянии наведения.
  await page.mouse.move(0, 0)
  await expect(
    page.getByRole('button', { name: t.categories.restoreLabel(hobby.name) }),
  ).toBeVisible()
}

const tree = (page: Page) => page.getByRole('list', { name: t.categories.treeLabel.expense })
const handle = (page: Page, name: string) =>
  page.getByRole('button', { name: t.categories.dnd.handle(name) })
const rowNames = (page: Page) =>
  tree(page)
    .getByRole('listitem')
    .evaluateAll((rows) =>
      rows.map((r) => `${r.getAttribute('aria-level')}:${r.querySelector('p')?.textContent}`),
    )

function bodyOf(request: Request) {
  return request.postDataJSON() as unknown
}

test.beforeEach(async ({ page }) => {
  await mockSignedIn(page)
})

test.describe('меню настроек', () => {
  test('скриншот', { tag: '@visual' }, async ({ page }) => {
    await page.goto('/settings')
    await ready(page, t.nav.settings)
    await expect(page).toHaveScreenshot('settings.png')
  })

  test('доступность и переход к категориям', { tag: '@a11y' }, async ({ page, isMobile }) => {
    await mockCategories(page)
    await page.goto('/settings')
    await ready(page, t.nav.settings)
    await expectNoAxeViolations(page)

    await page
      .getByRole('main')
      .getByRole('link', { name: new RegExp(t.categories.title) })
      .click()
    await ready(page, t.categories.title)
    // Пункт меню раздела подсвечен и на вложенном адресе.
    const nav = page.getByRole('navigation', { name: t.nav.label })
    await expect(
      nav.getByRole('link', { name: isMobile ? t.nav.more : t.nav.settings }),
    ).toHaveAttribute('aria-current', 'page')

    // На mobile — «Назад» к меню настроек в заголовке; на desktop его нет (есть боковое меню).
    const back = page.getByRole('link', { name: t.settings.back })
    if (isMobile) {
      await back.click()
      await ready(page, t.nav.settings)
    } else {
      await expect(back).toHaveCount(0)
    }
  })
})

test.describe('категории: дерево', () => {
  test('скриншот расходов с подкатегориями и архивом', { tag: '@visual' }, async ({ page }) => {
    await mockCategories(page)
    await openCategories(page)
    // Экран повыше, чтобы в кадр вошёл и раскрытый архив (fullPage на mobile наложил бы
    // нижнюю панель поверх середины страницы).
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 1100 })
    await expandArchive(page, 3)
    await expect(page).toHaveScreenshot('categories-expense.png')
  })

  test('скриншот доходов', { tag: '@visual' }, async ({ page }) => {
    await mockCategories(page)
    await openCategories(page, '?kind=income')
    await expect(page).toHaveScreenshot('categories-income.png')
  })

  test('доступность: расходы с открытым архивом', { tag: '@a11y' }, async ({ page }) => {
    await mockCategories(page)
    await openCategories(page)
    await expandArchive(page, 3)
    await expectNoAxeViolations(page)
    expect(await horizontalOverflow(page)).toBe(0)
    expect(await rowNames(page)).toEqual([
      '1:Продукты',
      '2:Молочное',
      '2:Овощи и фрукты',
      '1:Кафе и рестораны',
      '1:Транспорт',
      '2:Такси',
      '2:Метро',
      `1:${longName.name}`,
      '1:Подарки',
    ])
  })

  test('вкладка — в адресе', { tag: '@a11y' }, async ({ page }) => {
    await mockCategories(page)
    await openCategories(page)
    await page.getByRole('tab', { name: t.categories.kinds.income }).click()
    await expect(page).toHaveURL(/\?kind=income$/)
    await expect(page.getByRole('list', { name: t.categories.treeLabel.income })).toBeVisible()
    await expectNoAxeViolations(page)
    await page.reload()
    await expect(page.getByRole('tab', { name: t.categories.kinds.income })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('зоны касания строк не меньше 44 px', { tag: '@a11y' }, async ({ page }) => {
    await mockCategories(page)
    await openCategories(page)
    const targets = [
      handle(page, 'Такси'),
      page.getByRole('button', { name: t.categories.actionsLabel('Такси') }),
      page.getByRole('button', { name: t.categories.archiveTitle(3) }),
    ]
    for (const target of targets) {
      const box = await target.boundingBox()
      expect(box?.width).toBeGreaterThanOrEqual(44)
      expect(box?.height).toBeGreaterThanOrEqual(44)
    }
  })
})

test.describe('категории: состояния', () => {
  test('пусто: объяснение и «Добавить категорию»', { tag: '@visual' }, async ({ page }) => {
    await mockCategories(page, [])
    await page.goto('/settings/categories')
    await ready(page, t.categories.title)
    await expect(page.getByRole('heading', { name: t.categories.emptyTitle.expense })).toBeVisible()
    await expect(page).toHaveScreenshot('categories-empty.png')
  })

  test('пусто: доступность и добавление', { tag: '@a11y' }, async ({ page }) => {
    const writes = await mockCategories(page, [])
    await page.goto('/settings/categories')
    await ready(page, t.categories.title)
    await expectNoAxeViolations(page)
    await page.getByRole('button', { name: t.categories.add }).click()
    const dialog = page.getByRole('dialog', { name: t.categories.form.createTitle })
    await expect(dialog.getByLabel(t.categories.form.name)).toBeFocused()
    await page.keyboard.type('  Продукты  ')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    expect(bodyOf(writes[0])).toEqual({ kind: 'expense', parentId: null, name: 'Продукты' })
  })

  test('загрузка: скелетон в форме дерева', { tag: '@visual' }, async ({ page }) => {
    // Ответ не приходит: скелетон появляется после 300 мс.
    await page.route(`**${API}/categories`, () => undefined)
    await page.goto('/settings/categories')
    await expect(page.getByRole('status')).toBeVisible()
    await fontsReady(page)
    await expect(page).toHaveScreenshot('categories-loading.png')
  })

  test('ошибка и «Повторить»', { tag: '@visual' }, async ({ page }) => {
    let fail = true
    await page.route(`**${API}/categories`, (route) =>
      fail ? problem(route, 500, 'internal') : route.fulfill({ json: { items: fixture } }),
    )
    await page.goto('/settings/categories')
    await expect(page.getByRole('heading', { name: t.categories.errorTitle })).toBeVisible({
      timeout: 10_000,
    })
    await fontsReady(page)
    await expect(page).toHaveScreenshot('categories-error.png')
    fail = false
    await page.getByRole('button', { name: t.errors.retry }).click()
    await expect(tree(page)).toBeVisible()
  })

  test('шрифт 200 %: дерево без горизонтального скролла', { tag: '@a11y' }, async ({ page }) => {
    await mockCategories(page)
    await openCategories(page)
    await enlargeFont(page)
    expect(await horizontalOverflow(page)).toBe(0)
  })

  test('скриншот дерева при шрифте 200 %', { tag: '@visual' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Крупный шрифт проверяем на узком экране')
    await mockCategories(page)
    await openCategories(page)
    await enlargeFont(page)
    await expect(page).toHaveScreenshot('categories-font-200.png')
  })
})

test.describe('категории: окна', () => {
  async function openMenu(page: Page, name: string) {
    await page.getByRole('button', { name: t.categories.actionsLabel(name) }).click()
    return page.getByRole('menu')
  }

  async function openMerge(page: Page) {
    await mockCategories(page)
    await openCategories(page)
    await (
      await openMenu(page, transport.name)
    )
      .getByRole('menuitem', { name: t.categories.remove })
      .click()
    const dialog = page.getByRole('dialog', { name: t.categories.merge.title(transport.name) })
    await expect(dialog).toBeVisible()
    return dialog
  }

  test('скриншот окна слияния', { tag: '@visual' }, async ({ page }) => {
    await openMerge(page)
    await fontsReady(page)
    await expect(page).toHaveScreenshot('categories-merge.png')
  })

  test('слияние: доступность, текст и запрос', { tag: '@a11y' }, async ({ page }) => {
    const dialog = await openMerge(page)
    await expectNoAxeViolations(page)
    // У «Транспорта» три подкатегории (одна в архиве) — удалятся все.
    await expect(dialog).toContainText(
      t.categories.merge.description(transport.name, '3 подкатегорий'),
    )
    // Без выбора — подсказка у поля, запроса нет.
    await dialog.getByRole('button', { name: t.categories.merge.submit }).click()
    await expect(dialog.getByText(t.categories.merge.targetRequired)).toBeVisible()

    // Поиск без учёта регистра и ё/е, по подкатегориям; сама категория и её подкатегории
    // в выборе отсутствуют.
    const field = dialog.getByLabel(t.categories.merge.target)
    await field.fill('такси')
    await expect(page.getByRole('option')).toHaveCount(0)
    await field.fill('МОЛОЧ')
    await page.getByRole('option', { name: 'Продукты › Молочное' }).click()

    let merged: unknown
    await page.route(`**${API}/categories/${transport.id}/merge`, (route) => {
      merged = route.request().postDataJSON()
      return route.fulfill({ status: 204 })
    })
    await dialog.getByRole('button', { name: t.categories.merge.submit }).click()
    await expect(dialog).toBeHidden()
    expect(merged).toEqual({ targetId: dairy.id })
  })

  test('переименование: занятое имя — ошибка у поля', { tag: '@a11y' }, async ({ page }) => {
    await mockCategories(page)
    await openCategories(page)
    await page.route(`**${API}/categories/${cafe.id}`, (route) =>
      problem(route, 422, 'validation_failed', {
        errors: [{ field: 'name', code: 'name_taken', message: 'x' }],
      }),
    )
    await (
      await openMenu(page, cafe.name)
    )
      .getByRole('menuitem', { name: t.categories.rename })
      .click()
    const dialog = page.getByRole('dialog', { name: t.categories.form.renameTitle })
    const field = dialog.getByLabel(t.categories.form.name)
    await expect(field).toHaveValue(cafe.name)
    await field.fill('Продукты')
    await dialog.getByRole('button', { name: t.categories.form.renameSubmit }).click()
    await expect(dialog.getByText(t.categories.form.nameTaken)).toBeVisible()
    await expect(field).toBeFocused()
    await expectNoAxeViolations(page)
  })

  test('«Переместить в…» с клавиатуры', { tag: '@a11y' }, async ({ page }) => {
    const writes = await mockCategories(page)
    await openCategories(page)
    const menuButton = page.getByRole('button', { name: t.categories.actionsLabel(cafe.name) })
    await menuButton.focus()
    await page.keyboard.press('Enter')
    const item = page.getByRole('menuitem', { name: t.categories.moveTo })
    await expect(item).toBeVisible()
    // Стрелками до пункта «Переместить в…» (первый — «Переименовать»).
    while (!(await item.evaluate((el) => el === document.activeElement))) {
      await page.keyboard.press('ArrowDown')
    }
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: t.categories.move.title(cafe.name) })
    await expect(dialog).toBeVisible()
    // Текущее место недоступно, сама категория в списке не показана.
    await expect(
      dialog.getByRole('radio', { name: new RegExp(t.categories.move.topLevel) }),
    ).toBeDisabled()
    await expect(dialog.getByRole('radio', { name: cafe.name })).toHaveCount(0)
    await expectNoAxeViolations(page)

    await dialog.getByRole('radio', { name: transport.name }).focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    // В конец «Транспорта»: после Метро (индекс среди всех, с архивным Каршерингом) — 3.
    await expect.poll(() => writes.length).toBe(1)
    expect(bodyOf(writes[0])).toEqual({ parentId: transport.id, index: 3 })
    expect(await rowNames(page)).toContain('2:Кафе и рестораны')
  })

  test('у категории с подкатегориями вложить нельзя', { tag: '@a11y' }, async ({ page }) => {
    await mockCategories(page)
    await openCategories(page)
    await (
      await openMenu(page, products.name)
    )
      .getByRole('menuitem', { name: t.categories.moveTo })
      .click()
    const dialog = page.getByRole('dialog', { name: t.categories.move.title(products.name) })
    await expect(dialog.getByText(t.categories.move.hasChildren)).toBeVisible()
    await expect(dialog.getByRole('radio', { name: transport.name })).toBeDisabled()
  })
})

test.describe('категории: перетаскивание', () => {
  test('клавиатура: вверх — в начало, затем «Отменить»', { tag: '@a11y' }, async ({ page }) => {
    const writes = await mockCategories(page)
    await openCategories(page)
    await handle(page, cafe.name).focus()
    await page.keyboard.press('Space')
    // Строка за строкой: «Овощи и фрукты», «Молочное», «Продукты».
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Space')
    await expect.poll(() => writes.length).toBe(1)
    expect(bodyOf(writes[0])).toEqual({ parentId: null, index: 0 })
    expect((await rowNames(page))[0]).toBe('1:Кафе и рестораны')
    // Фокус остаётся на ручке перемещённой категории.
    await expect(handle(page, cafe.name)).toBeFocused()

    await page.getByRole('button', { name: t.common.undo }).click()
    await expect.poll(() => writes.length).toBe(2)
    // Обратно на прежнее место: второй среди соседей верхнего уровня.
    expect(bodyOf(writes[1])).toEqual({ parentId: null, index: 1 })
  })

  test('клавиатура: вправо — подкатегорией', { tag: '@a11y' }, async ({ page }) => {
    const writes = await mockCategories(page)
    await openCategories(page)
    await handle(page, cafe.name).focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect.poll(() => writes.length).toBe(1)
    // Последней подкатегорией «Продуктов».
    expect(bodyOf(writes[0])).toEqual({ parentId: products.id, index: 2 })
    expect((await rowNames(page)).slice(0, 4)).toEqual([
      '1:Продукты',
      '2:Молочное',
      '2:Овощи и фрукты',
      '2:Кафе и рестораны',
    ])
  })

  test('клавиатура: Esc отменяет', { tag: '@a11y' }, async ({ page }) => {
    const writes = await mockCategories(page)
    await openCategories(page)
    await handle(page, cafe.name).focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('status').filter({ hasText: t.categories.dnd.cancelled(cafe.name) }),
    ).toBeAttached()
    expect(writes).toHaveLength(0)
  })

  test('мышь: подкатегория — на верхний уровень', { tag: '@a11y' }, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Мышь — на desktop; касание проверяется отдельно')
    const writes = await mockCategories(page)
    await openCategories(page)
    const from = (await handle(page, metro.name).boundingBox())!
    const target = (await handle(page, longName.name).boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    // Вниз на строку «Образование…» и влево на уровень.
    await page.mouse.move(from.x + from.width / 2 - 10, target.y + target.height / 2, { steps: 10 })
    await page.mouse.move(from.x + from.width / 2 - 40, target.y + target.height / 2 + 2, {
      steps: 5,
    })
    await page.mouse.up()
    await expect.poll(() => writes.length).toBe(1)
    expect(bodyOf(writes[0])).toMatchObject({ parentId: null })
    expect(await rowNames(page)).toContain('1:Метро')
  })

  test('касание: перетаскивание за ручку', { tag: '@a11y' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Касание — на mobile')
    const writes = await mockCategories(page)
    await openCategories(page)
    const from = (await handle(page, gifts.name).boundingBox())!
    const to = (await handle(page, products.name).boundingBox())!
    // Playwright не умеет тянуть пальцем — шлём сенсорные события через CDP.
    const cdp = await page.context().newCDPSession(page)
    const point = (x: number, y: number) => ({ touchPoints: [{ x, y }] })
    const x = from.x + from.width / 2
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      ...point(x, from.y + from.height / 2),
    })
    const steps = 12
    for (let i = 1; i <= steps; i++) {
      // Чуть выше верхнего края строки «Продукты» — первой в списке.
      const y = from.y + from.height / 2 + ((to.y - from.y - from.height / 2 - 8) * i) / steps
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', ...point(x, y) })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => writes.length).toBe(1)
    expect(bodyOf(writes[0])).toEqual({ parentId: null, index: 0 })
    expect((await rowNames(page))[0]).toBe('1:Подарки')
  })

  test('ошибка перемещения: откат и понятный текст', { tag: '@a11y' }, async ({ page }) => {
    await mockCategories(page)
    await openCategories(page)
    await page.route(`**${API}/categories/${cafe.id}/move`, (route) =>
      problem(route, 422, 'validation_failed', {
        errors: [{ field: 'parentId', code: 'name_taken', message: 'x' }],
      }),
    )
    await handle(page, cafe.name).focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Space')
    await expect(page.getByText(t.categories.errors.nameTaken)).toBeVisible()
    expect((await rowNames(page)).slice(0, 4)).toEqual([
      '1:Продукты',
      '2:Молочное',
      '2:Овощи и фрукты',
      '1:Кафе и рестораны',
    ])
  })
})

test.describe('категории: архив', () => {
  test('архив сразу, «Отменить» возвращает', { tag: '@a11y' }, async ({ page }) => {
    const writes = await mockCategories(page)
    await openCategories(page)
    await page.getByRole('button', { name: t.categories.actionsLabel(transport.name) }).click()
    await page.getByRole('menuitem', { name: t.categories.archive }).click()
    // Родитель ушёл в архив вместе с активными подкатегориями.
    expect(await rowNames(page)).not.toContain('1:Транспорт')
    expect(await rowNames(page)).not.toContain('2:Такси')
    await expect(page.getByRole('button', { name: t.categories.archiveTitle(6) })).toBeVisible()
    await expect(page.getByText(t.categories.archived(transport.name))).toBeVisible()

    await page.getByRole('button', { name: t.common.undo }).click()
    await expect
      .poll(() => writes.map((w) => w.url().split('/').pop()))
      .toEqual(['archive', 'unarchive'])
    expect(await rowNames(page)).toContain('2:Такси')
  })

  test('«Вернуть» из архива', { tag: '@a11y' }, async ({ page }) => {
    const writes = await mockCategories(page)
    await openCategories(page)
    await expandArchive(page, 3)
    await page.getByRole('button', { name: t.categories.restoreLabel(fishing.name) }).click()
    await expect
      .poll(() => writes.map((w) => w.url()))
      .toEqual([expect.stringContaining(`/categories/${fishing.id}/unarchive`)])
    // Подкатегория возвращается вместе с архивным родителем.
    expect(await rowNames(page)).toEqual(expect.arrayContaining(['1:Хобби', '2:Рыбалка']))
  })
})
