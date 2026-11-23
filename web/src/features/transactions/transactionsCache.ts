import type { QueryClient } from '@tanstack/react-query'

import { getListAccountsQueryKey, getListTransactionsQueryKey } from '../../shared/api'

// Общий префикс ключей всех запросов операций: лента (`/api/v1/transactions` с любыми
// параметрами, в т. ч. бесконечная), итоги (`…/summary`), умные значения (`…/defaults`)
// и отдельная операция (`…/{id}`).
const TRANSACTIONS_PREFIX = getListTransactionsQueryKey()[0]

/**
 * Сбросить кэш после любого изменения операции (создание, правка, удаление, отмена):
 * ленту и итоги во всех вариантах фильтров, `defaults` (последний счёт, частые категории)
 * и список счетов — в нём остатки.
 *
 * Ключи сравниваются предикатом по префиксу адреса, а не точным ключом: так попадают
 * все варианты параметров и ключи хуков, которые появятся позже (`useInfinite…`).
 */
export function invalidateAfterTransactionChange(qc: QueryClient): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({
      predicate: (query) =>
        query.queryKey.some(
          (part) => typeof part === 'string' && part.startsWith(TRANSACTIONS_PREFIX),
        ),
    }),
    qc.invalidateQueries({ queryKey: getListAccountsQueryKey() }),
  ]).then(() => undefined)
}
