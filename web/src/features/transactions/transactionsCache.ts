import type { Mutation, QueryClient } from '@tanstack/react-query'

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

/**
 * Общая очередь изменений операций: создание и «Отменить» быстрого ввода, правка,
 * удаление и восстановление в ленте. Мутации одного `scope` TanStack Query выполняет
 * строго по одной, в порядке вызова. Без общей очереди перезапрос после создания мог бы
 * вернуть в ленту строку, удаление которой ещё не дошло до сервера, а «Отменить» —
 * обогнать действие, которое отменяет. Ждать приходится, только пока идёт другое
 * изменение операций — обычно это доли секунды.
 */
export const TRANSACTIONS_SCOPE = { id: 'transactions' }

const inScope = (m: Mutation<unknown, unknown, unknown, unknown>) =>
  m.options.scope?.id === TRANSACTIONS_SCOPE.id

/**
 * Сброс кэша после мутации из очереди — только когда она последняя (вызывать из
 * `onSettled`, где сама мутация ещё считается идущей, отсюда `<= 1`): перезапрос посреди
 * очереди затёр бы оптимистичные изменения, которые ещё не дошли до сервера.
 */
export function invalidateWhenQueueSettles(qc: QueryClient): Promise<void> | undefined {
  if (qc.isMutating({ predicate: inScope }) <= 1) return invalidateAfterTransactionChange(qc)
}
