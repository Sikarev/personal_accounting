import type { ComboboxItem, ComboboxItemGroup } from '@mantine/core'

import type { Category, CategoryKind } from '../../shared/api'
import type { Messages } from '../../shared/i18n'
import { categoryLabel, siblingsOf } from '../../shared/lib/categoryTree'
import { formatPeriod } from '../../shared/lib/date'
import { detectPreset, type FeedFilters } from '../../shared/lib/transactionFilters'
import type { FilterChip as GenericFilterChip } from '../../shared/ui'

/**
 * Категории для фильтра — обоих видов (группами «Расходы» / «Доходы»), в порядке дерева,
 * подкатегория — «Родитель › Подкатегория», архивные — с пометкой. Категория верхнего
 * уровня включает подкатегории (так считает API).
 */
export function categoryFilterOptions(
  categories: readonly Category[],
  t: Messages,
): ComboboxItemGroup<ComboboxItem>[] {
  const label = (c: Category, parent: Category | null) => {
    const text = categoryLabel(c, parent)
    return c.archivedAt === null ? text : t.feed.filters.archived(text)
  }
  const group = (kind: CategoryKind): ComboboxItemGroup<ComboboxItem> => ({
    group: t.feed.filters.categoryGroups[kind],
    items: siblingsOf(categories, kind, null).flatMap((parent) => [
      { value: parent.id, label: label(parent, null) },
      ...siblingsOf(categories, kind, parent.id).map((child) => ({
        value: child.id,
        label: label(child, parent),
      })),
    ]),
  })
  return [group('expense'), group('income')].filter((g) => g.items.length > 0)
}

/** Чип активного фильтра ленты: `without` — какие поля сбросить, чтобы его убрать. */
export type FilterChip = GenericFilterChip<Partial<FeedFilters>>

/** Активные фильтры — чипами над лентой (ux.md, «Лента»): каждый снимается отдельно. */
export function activeFilterChips(
  filters: FeedFilters,
  lookups: {
    accountNames: ReadonlyMap<string, string>
    categories: ReadonlyMap<string, Category>
    today: string
    /** Текущий пользователь: фильтр по автору — «Мои операции». */
    meId?: string
  },
  t: Messages,
): FilterChip[] {
  const chips: FilterChip[] = []
  const { from, to } = filters
  if (from !== null || to !== null) {
    const preset = detectPreset({ from, to }, lookups.today)
    chips.push({
      key: 'period',
      label:
        preset === 'custom' || preset === 'all'
          ? formatPeriod(from, to, lookups.today)
          : t.feed.filters.periods[preset],
      without: { from: null, to: null },
    })
  }
  for (const kind of filters.kind) {
    chips.push({
      key: `kind:${kind}`,
      label: t.feed.filters.kinds[kind],
      without: { kind: filters.kind.filter((k) => k !== kind) },
    })
  }
  for (const id of filters.accountId) {
    chips.push({
      key: `account:${id}`,
      label: lookups.accountNames.get(id) ?? t.feed.row.unknownAccount,
      without: { accountId: filters.accountId.filter((a) => a !== id) },
    })
  }
  for (const id of filters.categoryId) {
    const category = lookups.categories.get(id)
    const parent = category?.parentId ? lookups.categories.get(category.parentId) : undefined
    chips.push({
      key: `category:${id}`,
      label: category ? categoryLabel(category, parent) : t.feed.filters.unknownCategory,
      without: { categoryId: filters.categoryId.filter((c) => c !== id) },
    })
  }
  for (const id of filters.authorId) {
    chips.push({
      key: `author:${id}`,
      label: id === lookups.meId ? t.feed.filters.mine : t.feed.filters.otherAuthor,
      without: { authorId: filters.authorId.filter((a) => a !== id) },
    })
  }
  const q = filters.q.trim()
  if (q) chips.push({ key: 'q', label: t.feed.filters.query(q), without: { q: '' } })
  return chips
}
