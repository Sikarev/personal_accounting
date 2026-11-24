import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'

import {
  getGetTransactionDefaultsQueryKey,
  getGetTransactionsSummaryQueryKey,
  getListAccountsQueryKey,
  getListTransactionsInfiniteQueryKey,
  getListTransactionsQueryKey,
  type Transaction,
  type TransactionList,
} from '../../shared/api'
import { compareFeedOrder } from '../../shared/lib/transactionFeed'

export type FeedData = InfiniteData<TransactionList, string | undefined>

/** Все загруженные ленты (с любыми фильтрами): ключ без параметров — префикс их ключей. */
const feedKey = () => getListTransactionsInfiniteQueryKey()

/** Убрать операцию со всех страниц ленты. */
export function withoutTransaction(data: FeedData, id: string): FeedData {
  return {
    ...data,
    pages: data.pages.map((page) =>
      page.items.some((t) => t.id === id)
        ? { ...page, items: page.items.filter((t) => t.id !== id) }
        : page,
    ),
  }
}

/**
 * Вернуть операцию в ленту (откат неудачного удаления) — на её место по порядку ленты:
 * в первую страницу, где после неё есть операция, иначе в конец последней.
 * Уже есть — данные не меняются.
 */
export function withTransaction(data: FeedData, transaction: Transaction): FeedData {
  if (data.pages.some((page) => page.items.some((t) => t.id === transaction.id))) return data
  const pageIndex = data.pages.findIndex((page) =>
    page.items.some((t) => compareFeedOrder(transaction, t) < 0),
  )
  const target = pageIndex === -1 ? data.pages.length - 1 : pageIndex
  if (target < 0) return data
  return {
    ...data,
    pages: data.pages.map((page, i) => {
      if (i !== target) return page
      const items = [...page.items]
      const at = items.findIndex((t) => compareFeedOrder(transaction, t) < 0)
      items.splice(at === -1 ? items.length : at, 0, transaction)
      return { ...page, items }
    }),
  }
}

/**
 * Убрать операцию из загруженных лент (у каждого набора фильтров — своя). Возвращает
 * ключи лент, где она была: вернуть её (откат, «Отменить») можно только туда — в ленту
 * с другим фильтром она не подходит, а в ленту, где её место на незагруженной странице,
 * попала бы дублем после подгрузки. Остальные ленты обновит перезапрос.
 */
export function removeFromFeeds(qc: QueryClient, id: string): QueryKey[] {
  const keys: QueryKey[] = []
  for (const [key, data] of qc.getQueriesData<FeedData>({ queryKey: feedKey() })) {
    if (!data?.pages.some((page) => page.items.some((t) => t.id === id))) continue
    keys.push(key)
    qc.setQueryData<FeedData>(key, withoutTransaction(data, id))
  }
  return keys
}

/** Вернуть операцию в ленты `keys` (из `removeFromFeeds`) — на её место по порядку. */
export function returnToFeeds(
  qc: QueryClient,
  keys: readonly QueryKey[],
  transaction: Transaction,
) {
  for (const key of keys) {
    qc.setQueryData<FeedData>(key, (old) => (old ? withTransaction(old, transaction) : old))
  }
}

/** Остановить загрузку лент: ответ, начатый до правки, затёр бы оптимистичное изменение. */
export function cancelFeedFetches(qc: QueryClient) {
  void qc.cancelQueries({ queryKey: feedKey() })
}

/**
 * После изменения операций на сервере: лента (с итогами дней), итоги выборки, остатки
 * счетов и умные значения быстрого ввода — всё могло измениться.
 */
export function invalidateTransactionData(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: feedKey() }),
    qc.invalidateQueries({ queryKey: getListTransactionsQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetTransactionsSummaryQueryKey() }),
    qc.invalidateQueries({ queryKey: getListAccountsQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetTransactionDefaultsQueryKey() }),
  ])
}
