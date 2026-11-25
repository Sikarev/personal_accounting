import { describe, expect, it } from 'vitest'

import type { Category } from '../../shared/api'
import {
  buildCategoryRows,
  donutSegments,
  OTHER_COLOR,
  rowColor,
  type CategoryRow,
} from './categoryReport'

function category(id: string, name: string, extra: Partial<Category> = {}): Category {
  return {
    id,
    kind: 'expense',
    parentId: null,
    name,
    sortOrder: 0,
    archivedAt: null,
    ...extra,
  }
}

const food = category('food', 'Продукты')
const dairy = category('dairy', 'Молочное', { parentId: 'food' })
const meat = category('meat', 'Мясо', { parentId: 'food' })
const cafe = category('cafe', 'Кафе')
const old = category('old', 'Старое', { archivedAt: '2026-01-01T00:00:00Z' })
const categories = [food, dairy, meat, cafe, old]

describe('buildCategoryRows', () => {
  it('подкатегории — в строке родителя, сумма родителя — свои + подкатегории', () => {
    const rows = buildCategoryRows(
      [
        { categoryId: 'dairy', amount: 300 },
        { categoryId: 'cafe', amount: 500 },
        { categoryId: 'food', amount: 100 },
        { categoryId: 'meat', amount: 200 },
      ],
      categories,
    )
    expect(rows.map((r) => [r.id, r.amount])).toEqual([
      ['food', 600],
      ['cafe', 500],
    ])
    // Собственные операции родителя — отдельной строкой, все по убыванию суммы.
    expect(rows[0].children).toEqual([
      { id: 'dairy', name: 'Молочное', archived: false, amount: 300, own: false },
      { id: 'meat', name: 'Мясо', archived: false, amount: 200, own: false },
      { id: 'food', name: 'Продукты', archived: false, amount: 100, own: true },
    ])
    expect(rows[1].children).toEqual([])
  })

  it('только собственные операции родителя — раскрывать нечего', () => {
    const rows = buildCategoryRows([{ categoryId: 'food', amount: 100 }], categories)
    expect(rows).toEqual([
      { id: 'food', name: 'Продукты', archived: false, amount: 100, children: [] },
    ])
  })

  it('только подкатегория — без строки «Без подкатегории»', () => {
    const rows = buildCategoryRows([{ categoryId: 'dairy', amount: 300 }], categories)
    expect(rows[0]).toMatchObject({ id: 'food', amount: 300 })
    expect(rows[0].children.map((c) => c.id)).toEqual(['dairy'])
  })

  it('архивная категория — с пометкой, неизвестная — без названия, сумма не теряется', () => {
    const rows = buildCategoryRows(
      [
        { categoryId: 'old', amount: 50 },
        { categoryId: 'ghost', amount: 70 },
      ],
      categories,
    )
    expect(rows).toEqual([
      { id: 'ghost', name: null, archived: false, amount: 70, children: [] },
      { id: 'old', name: 'Старое', archived: true, amount: 50, children: [] },
    ])
  })

  it('подкатегория с неизвестным родителем — сама по себе верхнего уровня', () => {
    const orphan = category('orphan', 'Сирота', { parentId: 'missing' })
    const rows = buildCategoryRows([{ categoryId: 'orphan', amount: 10 }], [orphan])
    expect(rows).toEqual([
      { id: 'orphan', name: 'Сирота', archived: false, amount: 10, children: [] },
    ])
  })

  it('равные суммы — по названию', () => {
    const rows = buildCategoryRows(
      [
        { categoryId: 'food', amount: 100 },
        { categoryId: 'cafe', amount: 100 },
      ],
      categories,
    )
    expect(rows.map((r) => r.name)).toEqual(['Кафе', 'Продукты'])
  })

  it('пустой отчёт — пустое дерево', () => {
    expect(buildCategoryRows([], categories)).toEqual([])
  })
})

const rowsOf = (count: number): CategoryRow[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `c${i}`,
    name: `Категория ${i}`,
    archived: false,
    amount: (count - i) * 100,
    children: [],
  }))

describe('donutSegments', () => {
  it('восемь категорий — восемь сегментов разных цветов, без «Прочего»', () => {
    const segments = donutSegments(rowsOf(8))
    expect(segments).toHaveLength(8)
    expect(segments.map((s) => s.color)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(segments.every((s) => s.categoryId !== null)).toBe(true)
  })

  it('больше восьми — семь крупнейших и «Прочее» с суммой остальных', () => {
    const segments = donutSegments(rowsOf(10))
    expect(segments).toHaveLength(8)
    expect(segments.slice(0, 7).map((s) => s.categoryId)).toEqual([
      'c0',
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
    ])
    // c7, c8, c9: 300 + 200 + 100.
    expect(segments[7]).toEqual({ categoryId: null, name: null, amount: 600, color: OTHER_COLOR })
  })

  it('цвет строки таблицы совпадает с её сегментом', () => {
    expect(rowColor(3, 8)).toBe(3)
    expect(rowColor(7, 8)).toBe(7)
    expect(rowColor(6, 10)).toBe(6)
    expect(rowColor(7, 10)).toBe(OTHER_COLOR)
    expect(rowColor(9, 10)).toBe(OTHER_COLOR)
  })
})
