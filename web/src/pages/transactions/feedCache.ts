import type { InfiniteData, QueryClient } from '@tanstack/react-query'

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

/** Изменить все загруженные ленты сразу. */
export function patchFeeds(qc: QueryClient, update: (data: FeedData) => FeedData) {
  qc.setQueriesData<FeedData>({ queryKey: feedKey() }, (old) => (old ? update(old) : old))
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
