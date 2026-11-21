import { describe, expect, it } from 'vitest'

import type { CategoryNode } from '../../../shared/lib/categoryTree'
import { currentPlace, flattenTree, getProjection, withoutChildrenOf } from './treeProjection'

function node(id: string, children: string[] = [], hasArchived = false): CategoryNode {
  const base = { kind: 'expense' as const, sortOrder: 0, archivedAt: null }
  return {
    ...base,
    id,
    name: id,
    parentId: null,
    children: children.map((c) => ({ ...base, id: c, name: c, parentId: id })),
    hasChildren: children.length > 0 || hasArchived,
  }
}

// a (a1, a2), b, c (c1)
const items = flattenTree([node('a', ['a1', 'a2']), node('b'), node('c', ['c1'])])
const INDENT = 32

describe('flattenTree', () => {
  it('родитель, за ним подкатегории', () => {
    expect(items.map((i) => `${i.id}:${i.depth}`)).toEqual([
      'a:0',
      'a1:1',
      'a2:1',
      'b:0',
      'c:0',
      'c1:1',
    ])
    expect(items.find((i) => i.id === 'a')!.hasChildren).toBe(true)
    expect(items.find((i) => i.id === 'b')!.hasChildren).toBe(false)
  })
})

describe('getProjection', () => {
  it('без сдвига — порядок среди соседей того же уровня', () => {
    // b над a (в начало): верхний уровень, позиция 0.
    const list = withoutChildrenOf(items, 'b')
    expect(getProjection(list, 'b', 'a', 0, INDENT)).toEqual({
      valid: true,
      depth: 0,
      parentId: null,
      index: 0,
      total: 3,
    })
  })

  it('сдвиг вправо под категорией — внутрь неё', () => {
    // b на месте (над собой), сдвиг вправо: станет последней подкатегорией a.
    expect(getProjection(items, 'b', 'b', INDENT, INDENT)).toMatchObject({
      depth: 1,
      parentId: 'a',
      index: 2,
      total: 3,
    })
  })

  it('в середине чужой группы — только подкатегорией, даже со сдвигом влево', () => {
    // b над a2 (тянем вверх): встаёт между a1 и a2.
    expect(getProjection(items, 'b', 'a2', -INDENT, INDENT)).toMatchObject({
      depth: 1,
      parentId: 'a',
      index: 1,
      total: 3,
    })
  })

  it('подкатегория в другую группу — к ближайшему родителю выше', () => {
    // a1 на место c1 (тянем вниз, c1 поднимается): последняя в c.
    expect(getProjection(items, 'a1', 'c1', 0, INDENT)).toMatchObject({
      depth: 1,
      parentId: 'c',
      index: 1,
      total: 2,
    })
  })

  it('сдвиг влево у подкатегории в конце группы — на верхний уровень', () => {
    expect(getProjection(items, 'a2', 'a2', -INDENT, INDENT)).toMatchObject({
      depth: 0,
      parentId: null,
      index: 1,
    })
  })

  it('без сдвига подкатегория в конце группы остаётся в ней', () => {
    expect(getProjection(items, 'a2', 'a2', 0, INDENT)).toMatchObject({
      depth: 1,
      parentId: 'a',
      index: 1,
    })
  })

  it('категорию с подкатегориями вложить нельзя', () => {
    const list = withoutChildrenOf(items, 'c')
    // c на месте b со сдвигом вправо: всё равно верхний уровень.
    expect(getProjection(list, 'c', 'b', INDENT, INDENT)).toMatchObject({ depth: 0 })
    // c внутрь группы a (над a2) — некуда: ниже идёт подкатегория.
    expect(getProjection(withoutChildrenOf(items, 'c'), 'c', 'a2', 0, INDENT)).toEqual({
      valid: false,
    })
  })

  it('с одними архивными подкатегориями тоже нельзя вложить', () => {
    const list = flattenTree([node('a', ['a1']), node('d', [], true)])
    // d на своём месте со сдвигом вправо: остаётся на верхнем уровне.
    expect(getProjection(list, 'd', 'd', INDENT, INDENT)).toMatchObject({ depth: 0 })
  })

  it('первая строка — только верхний уровень', () => {
    expect(getProjection(items, 'b', 'a', INDENT, INDENT)).toMatchObject({ depth: 0, index: 0 })
  })

  it('неизвестный id', () => {
    expect(getProjection(items, 'x', 'a', 0, INDENT)).toBeNull()
  })
})

describe('currentPlace', () => {
  it('позиция среди соседей', () => {
    expect(currentPlace(items, 'a2')).toEqual({ parentId: 'a', index: 1 })
    expect(currentPlace(items, 'c')).toEqual({ parentId: null, index: 2 })
  })
})
