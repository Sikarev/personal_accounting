import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'

import {
  getListTransactionsInfiniteQueryKey,
  type Account,
  type Transaction,
  type TransactionList,
  type TransactionRequest,
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
 * Заменить операцию во всех загруженных лентах (правка). Возвращает ключи лент, где она
 * была, — туда же откатывается прежняя версия при ошибке. Если правка увела операцию
 * из фильтра ленты или поменяла дату, порядок и состав поправит перезапрос после ответа.
 */
export function replaceInFeeds(qc: QueryClient, transaction: Transaction): QueryKey[] {
  const keys: QueryKey[] = []
  for (const [key, data] of qc.getQueriesData<FeedData>({ queryKey: feedKey() })) {
    if (!data?.pages.some((page) => page.items.some((t) => t.id === transaction.id))) continue
    keys.push(key)
    qc.setQueryData<FeedData>(key, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: page.items.map((t) => (t.id === transaction.id ? transaction : t)),
      })),
    })
  }
  return keys
}

/**
 * Операция после правки — как её покажет сервер, пока ответа нет: поля из тела запроса,
 * валюты — по счетам. Автор, id и права не меняются.
 */
export function applyEdit(
  transaction: Transaction,
  body: TransactionRequest,
  accounts: readonly Pick<Account, 'id' | 'currency'>[],
): Transaction {
  const currencyOf = (id: string | null | undefined) =>
    accounts.find((a) => a.id === id)?.currency ?? null
  const transfer = body.kind === 'transfer'
  return {
    ...transaction,
    kind: body.kind,
    date: body.date,
    accountId: body.accountId,
    amount: body.amount,
    currency: currencyOf(body.accountId),
    toAccountId: transfer ? (body.toAccountId ?? null) : null,
    toAmount: transfer ? (body.toAmount ?? body.amount) : null,
    toCurrency: transfer ? currencyOf(body.toAccountId) : null,
    categoryId: transfer ? null : (body.categoryId ?? null),
    comment: (body.comment ?? '').trim(),
  }
}
