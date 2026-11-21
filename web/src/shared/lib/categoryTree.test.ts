import { describe, expect, it } from 'vitest'

import type { Category } from '../api'
import {
  activeTree,
  applyArchive,
  applyMove,
  applyUnarchive,
  archivedEntries,
  categoryOptions,
  currentMoveIndex,
  toMoveIndex,
} from './categoryTree'

const T1 = '2026-11-01T10:00:00Z'
const T2 = '2026-11-02T10:00:00Z'

function cat(
  id: string,
  sortOrder: number,
  parentId: string | null = null,
  archivedAt: string | null = null,
  kind: Category['kind'] = 'expense',
): Category {
  return { id, kind, parentId, name: id.toUpperCase(), sortOrder, archivedAt }
}

// Расходы: a (a1, a2-архив, a3), b-архив (b1 — в архиве вместе с b), c; доход: i.
const list: Category[] = [
  cat('c', 4),
  cat('a', 1),
  cat('b', 2, null, T1),
  cat('x', 3, null, T2),
  cat('a1', 1, 'a'),
  cat('a2', 2, 'a', T1),
  cat('a3', 3, 'a'),
  cat('b1', 1, 'b', T1),
  cat('i', 1, null, null, 'income'),
]

const ids = (items: { id: string }[]) => items.map((c) => c.id)

describe('activeTree', () => {
  it('только активные, по sortOrder, только своего вида', () => {
    const tree = activeTree(list, 'expense')
    expect(ids(tree)).toEqual(['a', 'c'])
    expect(ids(tree[0].children)).toEqual(['a1', 'a3'])
    expect(ids(activeTree(list, 'income'))).toEqual(['i'])
  })
})

describe('archivedEntries', () => {
  it('в порядке дерева, с родителем', () => {
    const entries = archivedEntries(list, 'expense')
    expect(entries.map((e) => [e.category.id, e.parent?.id ?? null])).toEqual([
      ['a2', 'a'],
      ['b', null],
      ['b1', 'b'],
      ['x', null],
    ])
  })
})

describe('toMoveIndex', () => {
  // Соседи верхнего уровня: a, b(архив), x(архив), c.
  it('перед видимым соседом — с учётом архивных между ними', () => {
    // c на место 1 среди видимых (после a): видимые без c — [a]; 1 ≥ длины → после a.
    expect(toMoveIndex(list, 'c', null, 1)).toBe(1)
    // c в начало — перед a.
    expect(toMoveIndex(list, 'c', null, 0)).toBe(0)
    // a в конец (после c): соседи без a — [b, x, c], c на 2 → 3.
    expect(toMoveIndex(list, 'a', null, 1)).toBe(3)
  })

  it('между подкатегориями с архивной посередине', () => {
    // c в a на видимую позицию 1: видимые [a1, a3] → перед a3, в полном списке [a1, a2, a3] — 2.
    expect(toMoveIndex(list, 'c', 'a', 1)).toBe(2)
    // в конец → после a3 = 3.
    expect(toMoveIndex(list, 'c', 'a', 2)).toBe(3)
  })

  it('у родителя без видимых детей — в конец', () => {
    expect(toMoveIndex(list, 'a1', 'c', 0)).toBe(0)
    expect(toMoveIndex(list, 'a1', 'b', 0)).toBe(1)
  })
})

describe('currentMoveIndex', () => {
  it('позиция среди всех соседей', () => {
    expect(currentMoveIndex(list, 'c')).toBe(3)
    expect(currentMoveIndex(list, 'a3')).toBe(2)
  })
})

describe('applyMove', () => {
  it('перенос к другому родителю перенумеровывает обе группы', () => {
    const next = applyMove(list, 'a1', 'c', 0)
    const byId = Object.fromEntries(next.map((c) => [c.id, c]))
    expect(byId.a1).toMatchObject({ parentId: 'c', sortOrder: 1 })
    expect(byId.a2.sortOrder).toBe(1)
    expect(byId.a3.sortOrder).toBe(2)
    expect(ids(activeTree(next, 'expense')[1].children)).toEqual(['a1'])
  })

  it('порядок среди тех же соседей', () => {
    const next = applyMove(list, 'c', null, 0)
    expect(ids(activeTree(next, 'expense'))).toEqual(['c', 'a'])
  })

  it('на верхний уровень, индекс за пределами — в конец', () => {
    const next = applyMove(list, 'a3', null, 100)
    expect(ids(activeTree(next, 'expense'))).toEqual(['a', 'c', 'a3'])
  })

  it('обратный move возвращает прежнее место', () => {
    const before = currentMoveIndex(list, 'a3')
    const moved = applyMove(list, 'a3', null, 0)
    const back = applyMove(moved, 'a3', 'a', before)
    expect(ids(activeTree(back, 'expense')[0].children)).toEqual(['a1', 'a3'])
    expect(back.find((c) => c.id === 'a3')!.sortOrder).toBe(3)
  })
})

describe('applyArchive / applyUnarchive', () => {
  const at = '2026-11-21T12:00:00Z'

  it('архив родителя уносит активные подкатегории, ранее архивные не трогает', () => {
    const next = applyArchive(list, 'a', at)
    const byId = Object.fromEntries(next.map((c) => [c.id, c.archivedAt]))
    expect(byId).toMatchObject({ a: at, a1: at, a3: at, a2: T1 })
  })

  it('возврат родителя возвращает ровно то, что ушло с ним', () => {
    const next = applyUnarchive(applyArchive(list, 'a', at), 'a')
    const byId = Object.fromEntries(next.map((c) => [c.id, c.archivedAt]))
    expect(byId).toMatchObject({ a: null, a1: null, a3: null, a2: T1 })
  })

  it('возврат подкатегории возвращает её архивного родителя (только его)', () => {
    const next = applyUnarchive(list, 'b1')
    const byId = Object.fromEntries(next.map((c) => [c.id, c.archivedAt]))
    expect(byId).toMatchObject({ b1: null, b: null, x: T2 })
  })
})

describe('categoryOptions', () => {
  it('активные в порядке дерева, подкатегории — с родителем', () => {
    expect(categoryOptions(list, 'expense').map((o) => o.label)).toEqual([
      'A',
      'A › A1',
      'A › A3',
      'C',
    ])
  })

  it('без исключённых', () => {
    expect(ids(categoryOptions(list, 'expense', ['a', 'a1']))).toEqual(['a3', 'c'])
  })
})
