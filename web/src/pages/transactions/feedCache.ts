import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'

import {
  getListTransactionsInfiniteQueryKey,
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
 * Заменить операцию во всех загруженных лентах, где она есть (ответ сервера на правку).
 * Если правка увела операцию из фильтра ленты или поменяла дату, порядок и состав
 * поправит перезапрос. Возвращает ключи лент, где она была.
 */
export function replaceInFeeds(qc: QueryClient, transaction: Transaction): QueryKey[] {
  const keys: QueryKey[] = []
  for (const [key, data] of qc.getQueriesData<FeedData>({ queryKey: feedKey() })) {
    const old = data?.pages.flatMap((page) => page.items).find((t) => t.id === transaction.id)
    if (!data || !old) continue
    keys.push(key)
    qc.setQueryData<FeedData>(key, replaced(data, old, transaction))
  }
  return keys
}

/**
 * Замена на месте; если сменилась дата — перестановка на место по порядку ленты: иначе
 * строка осталась бы в чужом дне (повторяющиеся заголовки дней и одинаковые `key`).
 */
export function replaced(data: FeedData, old: Transaction, next: Transaction): FeedData {
  if (old.date !== next.date) return withTransaction(withoutTransaction(data, old.id), next)
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((t) => (t.id === next.id ? next : t)),
    })),
  }
}
