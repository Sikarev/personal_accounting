import type { CategoryNode } from '../../../shared/lib/categoryTree'

// Перетаскивание в дереве глубиной 2 по образцу SortableTree из примеров @dnd-kit:
// дерево разворачивается в плоский список, место определяет вертикальная позиция,
// а уровень — горизонтальный сдвиг (мышь или палец вправо — «внутрь», влево — «наружу»;
// с клавиатуры — стрелки вправо/влево). Вся логика здесь — чистые функции с тестами.

export type FlatItem = {
  id: string
  name: string
  parentId: string | null
  depth: 0 | 1
  /** Есть подкатегории (и архивные тоже): такую категорию нельзя вложить в другую. */
  hasChildren: boolean
}

/** Дерево → плоский список: родитель, сразу за ним его подкатегории. */
export function flattenTree(nodes: readonly CategoryNode[]): FlatItem[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      name: node.name,
      parentId: null,
      depth: 0 as const,
      hasChildren: node.hasChildren,
    },
    ...node.children.map((child) => ({
      id: child.id,
      name: child.name,
      parentId: node.id,
      depth: 1 as const,
      hasChildren: false,
    })),
  ])
}

/** Пока тащим родителя, его подкатегории едут вместе с ним — в списке их нет. */
export function withoutChildrenOf(items: readonly FlatItem[], id: string | null): FlatItem[] {
  return id === null ? [...items] : items.filter((item) => item.parentId !== id)
}

export type Projection =
  | {
      valid: true
      depth: 0 | 1
      parentId: string | null
      /** Позиция среди видимых соседей у нового родителя (без самой категории). */
      index: number
      /** Сколько видимых соседей будет у нового родителя вместе с категорией. */
      total: number
    }
  /** Сюда положить нельзя: например, категорию с подкатегориями — в середину чужой группы. */
  | { valid: false }

function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
  const result = [...items]
  const [moved] = result.splice(from, 1)
  result.splice(to, 0, moved)
  return result
}

/**
 * Куда встанет категория `activeId`, если отпустить её над `overId` со сдвигом `offsetX`
 * по горизонтали (в пикселях; `indent` — ширина одного уровня отступа).
 *
 * Правила дерева (docs/data-model.md → «Категории»): глубина 2; категорию с подкатегориями
 * нельзя вложить; подкатегория встаёт к ближайшему родителю выше неё.
 */
export function getProjection(
  items: readonly FlatItem[],
  activeId: string,
  overId: string,
  offsetX: number,
  indent: number,
): Projection | null {
  const activeIndex = items.findIndex((item) => item.id === activeId)
  const overIndex = items.findIndex((item) => item.id === overId)
  if (activeIndex < 0 || overIndex < 0) return null

  const active = items[activeIndex]
  const moved = arrayMove(items, activeIndex, overIndex)
  const prev = moved[overIndex - 1]
  const next = moved[overIndex + 1]

  // Глубже, чем на уровень под соседом сверху, не бывает; первая строка — только верхний
  // уровень; категорию с подкатегориями вложить нельзя.
  const maxDepth = !prev || active.hasChildren ? 0 : 1
  // Если ниже идёт подкатегория, мы внутри её группы — и сами можем быть только подкатегорией.
  const minDepth = next?.depth ?? 0
  if (minDepth > maxDepth) return { valid: false }

  const wanted = active.depth + Math.round(offsetX / indent)
  const depth: 0 | 1 = Math.min(Math.max(wanted, minDepth), maxDepth) === 0 ? 0 : 1
  const parentId = depth === 0 ? null : prev.depth === 0 ? prev.id : prev.parentId

  const isSibling = (item: FlatItem) =>
    item.id !== activeId && (depth === 0 ? item.depth === 0 : item.parentId === parentId)
  const index = moved.slice(0, overIndex).filter(isSibling).length
  const total = moved.filter(isSibling).length + 1
  return { valid: true, depth, parentId, index, total }
}

/** Позиция категории среди видимых соседей сейчас — чтобы понять, сдвинулась ли она. */
export function currentPlace(
  items: readonly FlatItem[],
  id: string,
): { parentId: string | null; index: number } | null {
  const item = items.find((i) => i.id === id)
  if (!item) return null
  const siblings = items.filter((i) => i.parentId === item.parentId && i.depth === item.depth)
  return { parentId: item.parentId, index: siblings.indexOf(item) }
}
