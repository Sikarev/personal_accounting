import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'

import {
  getListTransactionsInfiniteQueryKey,
  getListTransactionsQueryKey,
  type Transaction,
  type TransactionList,
} from '../../shared/api'
import { compareFeedOrder } from '../../shared/lib/transactionFeed'

// Оптимистичные правки загруженных списков операций: лента «Операции» (бесконечная, со
// страницами) и «Последние операции» на главной (обычный `GET /transactions?limit=10`).
// Обычный список — это одна страница: те же правила, что для ленты.

/** Бесконечная лента: страницы `GET /transactions`. */
export type FeedData = InfiniteData<TransactionList, string | undefined>

/** Загруженный список операций: бесконечная лента или один ответ `GET /transactions`. */
export type ListData = FeedData | TransactionList

/** Все бесконечные ленты (с любыми фильтрами): ключ без параметров — префикс их ключей. */
const feedKey = () => getListTransactionsInfiniteQueryKey()
/** Все обычные списки (`useListTransactions`) — у бесконечных ключ начинается с 'infinite'. */
const listKey = () => getListTransactionsQueryKey()

const pagesOf = (data: ListData): TransactionList[] => ('pages' in data ? data.pages : [data])

function withPages<T extends ListData>(data: T, pages: TransactionList[]): T {
  return ('pages' in data ? { ...data, pages } : pages[0]) as T
}

/** Все загруженные списки операций: ключ и данные. */
function loadedLists(qc: QueryClient): [QueryKey, ListData | undefined][] {
  return [
    ...qc.getQueriesData<FeedData>({ queryKey: feedKey() }),
    ...qc.getQueriesData<TransactionList>({ queryKey: listKey() }),
  ]
}

const contains = (data: ListData, id: string) =>
  pagesOf(data).some((page) => page.items.some((t) => t.id === id))

/** Убрать операцию со всех страниц списка. */
export function withoutTransaction<T extends ListData>(data: T, id: string): T {
  return withPages(
    data,
    pagesOf(data).map((page) =>
      page.items.some((t) => t.id === id)
        ? { ...page, items: page.items.filter((t) => t.id !== id) }
        : page,
    ),
  )
}

/**
 * Вернуть операцию в список (откат неудачного удаления) — на её место по порядку ленты:
 * в первую страницу, где после неё есть операция, иначе в конец последней.
 * Уже есть — данные не меняются.
 */
export function withTransaction<T extends ListData>(data: T, transaction: Transaction): T {
  if (contains(data, transaction.id)) return data
  const pages = pagesOf(data)
  const pageIndex = pages.findIndex((page) =>
    page.items.some((t) => compareFeedOrder(transaction, t) < 0),
  )
  const target = pageIndex === -1 ? pages.length - 1 : pageIndex
  if (target < 0) return data
  return withPages(
    data,
    pages.map((page, i) => {
      if (i !== target) return page
      const items = [...page.items]
      const at = items.findIndex((t) => compareFeedOrder(transaction, t) < 0)
      items.splice(at === -1 ? items.length : at, 0, transaction)
      return { ...page, items }
    }),
  )
}

/**
 * Убрать операцию из загруженных списков (у каждого набора фильтров — свой). Возвращает
 * ключи списков, где она была: вернуть её (откат, «Отменить») можно только туда — в ленту
 * с другим фильтром она не подходит, а в ленту, где её место на незагруженной странице,
 * попала бы дублем после подгрузки. Остальные списки обновит перезапрос.
 */
export function removeFromFeeds(qc: QueryClient, id: string): QueryKey[] {
  const keys: QueryKey[] = []
  for (const [key, data] of loadedLists(qc)) {
    if (!data || !contains(data, id)) continue
    keys.push(key)
    qc.setQueryData<ListData>(key, withoutTransaction(data, id))
  }
  return keys
}

/** Вернуть операцию в списки `keys` (из `removeFromFeeds`) — на её место по порядку. */
export function returnToFeeds(
  qc: QueryClient,
  keys: readonly QueryKey[],
  transaction: Transaction,
) {
  for (const key of keys) {
    qc.setQueryData<ListData>(key, (old) => (old ? withTransaction(old, transaction) : old))
  }
}

/** Остановить загрузку списков: ответ, начатый до правки, затёр бы оптимистичное изменение. */
export function cancelFeedFetches(qc: QueryClient) {
  void qc.cancelQueries({ queryKey: feedKey() })
  void qc.cancelQueries({ queryKey: listKey() })
}

/**
 * Заменить операцию во всех загруженных списках, где она есть (ответ сервера на правку).
 * Если правка увела операцию из фильтра ленты или поменяла дату, порядок и состав
 * поправит перезапрос. Возвращает ключи списков, где она была.
 */
export function replaceInFeeds(qc: QueryClient, transaction: Transaction): QueryKey[] {
  const keys: QueryKey[] = []
  for (const [key, data] of loadedLists(qc)) {
    const old =
      data &&
      pagesOf(data)
        .flatMap((page) => page.items)
        .find((t) => t.id === transaction.id)
    if (!data || !old) continue
    keys.push(key)
    qc.setQueryData<ListData>(key, replaced(data, old, transaction))
  }
  return keys
}

/**
 * Замена на месте; если сменилась дата — перестановка на место по порядку ленты: иначе
 * строка осталась бы в чужом дне (повторяющиеся заголовки дней и одинаковые `key`).
 */
export function replaced<T extends ListData>(data: T, old: Transaction, next: Transaction): T {
  if (old.date !== next.date) return withTransaction(withoutTransaction(data, old.id), next)
  return withPages(
    data,
    pagesOf(data).map((page) => ({
      ...page,
      items: page.items.map((t) => (t.id === next.id ? next : t)),
    })),
  )
}
