import { describe, expect, it } from 'vitest'

import type { Transaction } from '../../shared/api'
import { withoutTransaction, withTransaction, type FeedData } from './feedCache'

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
