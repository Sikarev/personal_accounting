import type { ComboboxItem, OptionsFilter } from '@mantine/core'

import type { Account } from '../api'
import type { Messages } from '../i18n'
import { matchesSearch } from './search'

// Варианты выпадающих списков фильтров — общие для ленты и отчётов.

/**
 * Счета для фильтра: сначала активные, потом архивные с пометкой — по старым операциям
 * тоже бывает нужно отфильтровать.
 */
export function accountOptions(accounts: readonly Account[], t: Messages): ComboboxItem[] {
  const active = accounts.filter((a) => a.archivedAt === null)
  const archived = accounts.filter((a) => a.archivedAt !== null)
  return [
    ...active.map((a) => ({ value: a.id, label: a.name })),
    ...archived.map((a) => ({ value: a.id, label: t.feed.filters.archived(a.name) })),
  ]
}

/** Поиск по подписи без учёта регистра и «ё/е», как в выборе категории. */
export const filterBySearch: OptionsFilter = ({ options, search }) =>
  options
    .map((o) =>
      'group' in o
        ? { ...o, items: o.items.filter((item) => matchesSearch(item.label, search)) }
        : o,
    )
    .filter((o) =>
      'group' in o ? o.items.length > 0 : matchesSearch((o as ComboboxItem).label, search),
    )
