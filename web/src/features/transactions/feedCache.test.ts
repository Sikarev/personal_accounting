import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import {
  getListTransactionsInfiniteQueryKey,
  getListTransactionsQueryKey,
  type Transaction,
  type TransactionList,
} from '../../shared/api'
import {
  removeFromFeeds,
  replaceInFeeds,
  replaced,
  returnToFeeds,
  withoutTransaction,
  withTransaction,
  type FeedData,
} from './feedCache'

function tx(id: number, date: string): Transaction {
  return {
    id: `01a1faf8-0000-7000-8000-${String(id).padStart(12, '0')}`,
    kind: 'expense',
    date,
    accountId: 'acc',
    amount: 100,
    currency: 'RUB',
    toAccountId: null,
    toAmount: null,
    toCurrency: null,
    categoryId: null,
    comment: '',
    author: null,
    counterparty: null,
    editable: true,
    createdAt: '2026-11-23T10:00:00Z',
    updatedAt: '2026-11-23T10:00:00Z',
  }
}

// Лента: дата ↓, затем id ↓.
const t5 = tx(5, '2026-11-23')
const t4 = tx(4, '2026-11-23')
const t3 = tx(3, '2026-11-22')
const t2 = tx(2, '2026-11-21')
const t1 = tx(1, '2026-11-20')

function feed(...pages: Transaction[][]): FeedData {
  return {
    pages: pages.map((items) => ({ items, days: [] })),
    pageParams: pages.map((_, i) => (i === 0 ? undefined : `c${i}`)),
  }
}

const ids = (data: FeedData) => data.pages.map((p) => p.items.map((t) => t.id.slice(-1)))

describe('withoutTransaction', () => {
  it('убирает операцию со своей страницы, остальные страницы — те же объекты', () => {
    const data = feed([t5, t4], [t3, t2])
    const next = withoutTransaction(data, t3.id)
    expect(ids(next)).toEqual([['5', '4'], ['2']])
    expect(next.pages[0]).toBe(data.pages[0])
  })
})

describe('withTransaction', () => {
  it('возвращает на прежнее место внутри страницы', () => {
    expect(ids(withTransaction(feed([t5, t3], [t2]), t4))).toEqual([['5', '4', '3'], ['2']])
  })

  it('последняя на странице — в конец этой страницы, если дальше идёт более старая', () => {
    expect(ids(withTransaction(feed([t5, t4], [t2, t1]), t3))).toEqual([
      ['5', '4'],
      ['3', '2', '1'],
    ])
  })

  it('самая старая — в конец последней страницы', () => {
    expect(ids(withTransaction(feed([t5], [t3]), t1))).toEqual([['5'], ['3', '1']])
  })

  it('уже есть — без изменений', () => {
    const data = feed([t5, t4])
    expect(withTransaction(data, t4)).toBe(data)
  })

  it('лента без страниц — без изменений', () => {
    const data = feed()
    expect(withTransaction(data, t4)).toBe(data)
  })
})

describe('removeFromFeeds / returnToFeeds', () => {
  const all = getListTransactionsInfiniteQueryKey()
  const expenses = getListTransactionsInfiniteQueryKey({ kind: ['expense'] })
  const incomes = getListTransactionsInfiniteQueryKey({ kind: ['income'] })
  // Лента, где операция ещё на незагруженной странице: видна только первая.
  const firstPageOnly = getListTransactionsInfiniteQueryKey({ q: 'x' })

  function setup() {
    const qc = new QueryClient()
    qc.setQueryData(all, feed([t5, t4], [t3, t2]))
    qc.setQueryData(expenses, feed([t4, t3]))
    qc.setQueryData(incomes, feed([t5]))
    qc.setQueryData(firstPageOnly, feed([t5, t2]))
    return qc
  }
  const idsOf = (qc: QueryClient, key: readonly unknown[]) => ids(qc.getQueryData<FeedData>(key)!)

  it('убирает только там, где операция была, и возвращает только туда', () => {
    const qc = setup()
    const keys = removeFromFeeds(qc, t3.id)
    expect(keys).toEqual(expect.arrayContaining([all, expenses]))
    expect(keys).toHaveLength(2)
    expect(idsOf(qc, all)).toEqual([['5', '4'], ['2']])
    expect(idsOf(qc, expenses)).toEqual([['4']])

    returnToFeeds(qc, keys, t3)
    expect(idsOf(qc, all)).toEqual([
      ['5', '4'],
      ['3', '2'],
    ])
    expect(idsOf(qc, expenses)).toEqual([['4', '3']])
    // В ленту доходов и в ленту без этой страницы операция не попадает.
    expect(idsOf(qc, incomes)).toEqual([['5']])
    expect(idsOf(qc, firstPageOnly)).toEqual([['5', '2']])
  })
})

describe('replaced', () => {
  it('та же дата — замена на месте', () => {
    const edited = { ...t4, comment: 'новый' }
    const next = replaced(feed([t5, t4], [t3]), t4, edited)
    expect(ids(next)).toEqual([['5', '4'], ['3']])
    expect(next.pages[0].items[1].comment).toBe('новый')
  })

  it('сменилась дата — строка переезжает на своё место, дублей нет', () => {
    // t5 (23-е) перенесли на 21-е: теперь между t3 (22-е) и t2 (21-е, id меньше).
    const moved = { ...t5, date: '2026-11-21' }
    const next = replaced(feed([t5, t4], [t3, t2]), t5, moved)
    expect(ids(next)).toEqual([['4'], ['3', '5', '2']])
  })
})

describe('обычный список (последние операции на главной)', () => {
  const recent = getListTransactionsQueryKey({ limit: 10 })
  const list = (...items: Transaction[]): TransactionList => ({ items, days: [] })
  const listIds = (qc: QueryClient) =>
    qc.getQueryData<TransactionList>(recent)!.items.map((t) => t.id.slice(-1))

  it('удаление и возврат — как у ленты, вместе с лентой', () => {
    const qc = new QueryClient()
    const all = getListTransactionsInfiniteQueryKey()
    qc.setQueryData(recent, list(t5, t4, t3))
    qc.setQueryData(all, feed([t5, t4], [t3]))

    const keys = removeFromFeeds(qc, t4.id)
    expect(keys).toEqual(expect.arrayContaining([recent, all]))
    expect(listIds(qc)).toEqual(['5', '3'])

    returnToFeeds(qc, keys, t4)
    expect(listIds(qc)).toEqual(['5', '4', '3'])
    // В ленте — в первую страницу, где после неё есть операция (см. withTransaction).
    expect(ids(qc.getQueryData<FeedData>(all)!)).toEqual([['5'], ['4', '3']])
  })

  it('правка заменяет строку, смена даты переставляет её', () => {
    const qc = new QueryClient()
    qc.setQueryData(recent, list(t5, t3, t2))
    expect(replaceInFeeds(qc, { ...t5, date: '2026-11-21' })).toEqual([recent])
    expect(listIds(qc)).toEqual(['3', '5', '2'])
  })
})
