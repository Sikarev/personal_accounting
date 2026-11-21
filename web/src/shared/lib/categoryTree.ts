import type { Category, CategoryKind } from '../api'

// Дерево категорий на клиенте (docs/api.md → «Категории»): `GET /categories` отдаёт плоский
// список обоих видов вместе с архивными, дерево и фильтр архива строятся здесь.
// Глубина — 2: категория верхнего уровня (`parentId: null`) и её подкатегории.

export type CategoryNode = Category & { children: Category[] }

/** Разделитель «Родитель › Подкатегория» в подписях. */
export const CATEGORY_PATH_SEPARATOR = ' › '

const isActive = (c: Category) => c.archivedAt === null

/**
 * Соседи в порядке сервера: по `sortOrder`. `Array.prototype.sort` стабилен, поэтому при
 * равных `sortOrder` остаётся порядок ответа сервера (дальше он сортирует по дате создания).
 */
function sorted(list: readonly Category[]): Category[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Все соседи (включая архивные) с данным родителем — в том порядке, в каком их считает `move`. */
export function siblingsOf(
  list: readonly Category[],
  kind: CategoryKind,
  parentId: string | null,
): Category[] {
  return sorted(list.filter((c) => c.kind === kind && c.parentId === parentId))
}

/** Активное дерево одного вида: верхний уровень и под ним активные подкатегории. */
export function activeTree(list: readonly Category[], kind: CategoryKind): CategoryNode[] {
  return siblingsOf(list, kind, null)
    .filter(isActive)
    .map((parent) => ({
      ...parent,
      children: siblingsOf(list, kind, parent.id).filter(isActive),
    }))
}

export type ArchivedEntry = {
  category: Category
  /** Родитель подкатегории (активный или тоже архивный); `null` — верхний уровень. */
  parent: Category | null
}

/**
 * Архивные категории одного вида в порядке дерева: архивный родитель, за ним его
 * подкатегории; архивные подкатегории активного родителя — под его именем.
 */
export function archivedEntries(list: readonly Category[], kind: CategoryKind): ArchivedEntry[] {
  const result: ArchivedEntry[] = []
  for (const parent of siblingsOf(list, kind, null)) {
    if (!isActive(parent)) result.push({ category: parent, parent: null })
    for (const child of siblingsOf(list, kind, parent.id)) {
      if (!isActive(child)) result.push({ category: child, parent })
    }
  }
  return result
}

/** Подкатегории (все, включая архивные). */
export function childrenOf(list: readonly Category[], id: string): Category[] {
  return list.filter((c) => c.parentId === id)
}

/** «Продукты › Молочное» для подкатегории, просто имя — для верхнего уровня. */
export function categoryLabel(category: Category, parent: Category | null | undefined): string {
  return parent ? `${parent.name}${CATEGORY_PATH_SEPARATOR}${category.name}` : category.name
}

/** Текущее место категории для `move`: позиция среди соседей (с архивными, без неё самой). */
export function currentMoveIndex(list: readonly Category[], id: string): number {
  const category = list.find((c) => c.id === id)
  if (!category) return 0
  return siblingsOf(list, category.kind, category.parentId).findIndex((c) => c.id === id)
}

/**
 * Перевод позиции среди **видимых** (активных) соседей в `index` для `move`, который
 * считает и архивных (docs/api.md). Категория встаёт прямо перед активным соседом, который
 * должен оказаться после неё, или сразу за последним активным, если она — последняя.
 */
export function toMoveIndex(
  list: readonly Category[],
  id: string,
  parentId: string | null,
  visibleIndex: number,
): number {
  const category = list.find((c) => c.id === id)
  if (!category) return visibleIndex
  const siblings = siblingsOf(list, category.kind, parentId).filter((c) => c.id !== id)
  const visible = siblings.filter(isActive)
  if (visibleIndex < visible.length) return siblings.indexOf(visible[Math.max(0, visibleIndex)])
  const last = visible.at(-1)
  return last ? siblings.indexOf(last) + 1 : siblings.length
}

/**
 * Результат `move` на клиенте (оптимистичное обновление): категория встаёт к новому родителю
 * на позицию `index`, старые и новые соседи перенумеровываются `1..n` — как на сервере.
 */
export function applyMove(
  list: readonly Category[],
  id: string,
  parentId: string | null,
  index: number,
): Category[] {
  const category = list.find((c) => c.id === id)
  if (!category) return [...list]

  const updates = new Map<string, Category>()
  const renumber = (items: Category[]) =>
    items.forEach((c, i) => updates.set(c.id, { ...(updates.get(c.id) ?? c), sortOrder: i + 1 }))

  if (category.parentId !== parentId) {
    renumber(siblingsOf(list, category.kind, category.parentId).filter((c) => c.id !== id))
  }
  const target = siblingsOf(list, category.kind, parentId).filter((c) => c.id !== id)
  target.splice(Math.min(Math.max(index, 0), target.length), 0, { ...category, parentId })
  renumber(target)

  return list.map((c) => updates.get(c.id) ?? c)
}

/** Архив на клиенте: категория и (у верхнего уровня) её активные подкатегории — с одним `archivedAt`. */
export function applyArchive(list: readonly Category[], id: string, at: string): Category[] {
  return list.map((c) =>
    (c.id === id || c.parentId === id) && c.archivedAt === null ? { ...c, archivedAt: at } : c,
  )
}

/**
 * Возврат из архива на клиенте (docs/data-model.md → «Категории»): вместе с родителем
 * возвращаются подкатегории с тем же `archivedAt`, вместе с подкатегорией — её архивный родитель.
 */
export function applyUnarchive(list: readonly Category[], id: string): Category[] {
  const category = list.find((c) => c.id === id)
  if (!category || category.archivedAt === null) return [...list]
  const at = category.archivedAt
  return list.map((c) => {
    const restore =
      c.id === id ||
      (c.parentId === id && c.archivedAt === at) ||
      (c.id === category.parentId && c.archivedAt !== null)
    return restore ? { ...c, archivedAt: null } : c
  })
}

export type CategoryOption = {
  id: string
  /** Подпись в списке: «Родитель › Подкатегория». */
  label: string
  /** Имя самой категории. */
  name: string
  /** Имя родителя у подкатегории, `null` — верхний уровень. */
  parentName: string | null
}

/**
 * Варианты выбора категории (пикер): активные, в порядке дерева, без `exclude`.
 * Выбрать можно и родителя, и подкатегорию; подкатегория исключённого родителя остаётся
 * в списке под полным именем. Архивных нет: у архивного родителя все подкатегории тоже
 * в архиве (data-model.md).
 */
export function categoryOptions(
  list: readonly Category[],
  kind: CategoryKind,
  exclude: readonly string[] = [],
): CategoryOption[] {
  const skip = new Set(exclude)
  const options: CategoryOption[] = []
  for (const parent of activeTree(list, kind)) {
    if (!skip.has(parent.id))
      options.push({ id: parent.id, label: parent.name, name: parent.name, parentName: null })
    for (const child of parent.children) {
      if (skip.has(child.id)) continue
      options.push({
        id: child.id,
        label: categoryLabel(child, parent),
        name: child.name,
        parentName: parent.name,
      })
    }
  }
  return options
}
