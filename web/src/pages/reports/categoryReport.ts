import type { Category, CategoryReportItem } from '../../shared/api'

// Отчёт по категориям: API отдаёт плоский список «категория → сумма операций, записанных
// прямо в неё» (docs/api.md → «Отчёты»). Здесь из него собирается то, что видит
// пользователь: дерево «категория верхнего уровня → подкатегории» для таблицы и не больше
// восьми сегментов для кольца (ux.md, «Отчёты»).

/** Строка подкатегории в таблице. */
export type CategoryLeaf = {
  /** id категории; у строки собственных операций родителя — id родителя. */
  id: string
  /** Название; `null` — категории нет в списке категорий (недоступна). */
  name: string | null
  archived: boolean
  amount: number
  /** Собственные операции родителя (записаны прямо в него, без подкатегории). */
  own: boolean
}

/** Строка категории верхнего уровня: свои операции + все подкатегории. */
export type CategoryRow = {
  id: string
  name: string | null
  archived: boolean
  amount: number
  /**
   * Подкатегории с операциями по убыванию суммы. Если у родителя есть и собственные
   * операции, и подкатегории, собственные — отдельной строкой (`own`). Без подкатегорий
   * список пуст: раскрывать нечего.
   */
  children: CategoryLeaf[]
}

const byAmount = <T extends { amount: number; name: string | null; id: string }>(a: T, b: T) =>
  b.amount - a.amount ||
  (a.name ?? '').localeCompare(b.name ?? '', 'ru') ||
  a.id.localeCompare(b.id)

/**
 * Дерево отчёта. Категории — весь список `GET /categories` (там есть и архивные: в отчёт
 * за прошлый период они попадают). Подкатегория, чей родитель не нашёлся, и неизвестная
 * категория считаются категориями верхнего уровня — сумма не теряется.
 */
export function buildCategoryRows(
  items: readonly CategoryReportItem[],
  categories: readonly Category[],
): CategoryRow[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const rows = new Map<string, { row: CategoryRow; own: number; subs: CategoryLeaf[] }>()

  const rowFor = (id: string) => {
    let entry = rows.get(id)
    if (!entry) {
      const category = byId.get(id)
      entry = {
        row: {
          id,
          name: category?.name ?? null,
          archived: category ? category.archivedAt !== null : false,
          amount: 0,
          children: [],
        },
        own: 0,
        subs: [],
      }
      rows.set(id, entry)
    }
    return entry
  }

  for (const { categoryId, amount } of items) {
    if (amount <= 0) continue
    const category = byId.get(categoryId)
    const parent = category?.parentId ? byId.get(category.parentId) : undefined
    if (category && parent) {
      const entry = rowFor(parent.id)
      entry.row.amount += amount
      entry.subs.push({
        id: category.id,
        name: category.name,
        archived: category.archivedAt !== null,
        amount,
        own: false,
      })
    } else {
      const entry = rowFor(categoryId)
      entry.row.amount += amount
      entry.own += amount
    }
  }

  return [...rows.values()]
    .map(({ row, own, subs }) => {
      if (subs.length === 0) return row
      const children = [...subs]
      if (own > 0) {
        children.push({
          id: row.id,
          name: row.name,
          archived: row.archived,
          amount: own,
          own: true,
        })
      }
      return { ...row, children: children.sort(byAmount) }
    })
    .sort(byAmount)
}

/** Сколько сегментов в кольце не больше (ux.md, «Отчёты»). */
export const MAX_SEGMENTS = 8

/** Сегмент кольца: категория верхнего уровня или «Прочее» (`categoryId: null`). */
export type Segment = {
  categoryId: string | null
  name: string | null
  amount: number
  /** Номер цвета палитры графиков (0…7); у «Прочего» и всего, что в него вошло, — `OTHER_COLOR`. */
  color: number
}

/**
 * Номер цвета «Прочего» — отдельный приглушённый (`--app-chart-other`), после восьми цветов
 * категорий: при восьми категориях без «Прочего» все восемь — цветные.
 */
export const OTHER_COLOR = MAX_SEGMENTS

/**
 * Сегменты кольца: не больше восьми. Если категорий больше — семь крупнейших и «Прочее»
 * (сумма остальных); в таблице «Прочее» не схлопывается.
 */
export function donutSegments(rows: readonly CategoryRow[], max = MAX_SEGMENTS): Segment[] {
  if (rows.length <= max) {
    return rows.map((row, i) => ({
      categoryId: row.id,
      name: row.name,
      amount: row.amount,
      color: i,
    }))
  }
  const top = rows.slice(0, max - 1)
  const rest = rows.slice(max - 1)
  return [
    ...top.map((row, i) => ({ categoryId: row.id, name: row.name, amount: row.amount, color: i })),
    {
      categoryId: null,
      name: null,
      amount: rest.reduce((sum, row) => sum + row.amount, 0),
      color: OTHER_COLOR,
    },
  ]
}

/** Цвет строки таблицы: тот же, что у её сегмента; вошедшие в «Прочее» — цвет «Прочего». */
export function rowColor(index: number, rowCount: number, max = MAX_SEGMENTS): number {
  if (rowCount <= max) return index
  return index < max - 1 ? index : OTHER_COLOR
}
