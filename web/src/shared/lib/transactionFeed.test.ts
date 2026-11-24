import { describe, expect, it } from 'vitest'

import type { Transaction } from '../api'
import {
  compareFeedOrder,
  groupByDay,
  mergeDays,
  summaryStats,
  totalAmounts,
} from './transactionFeed'

let seq = 0
function tx(date: string, overrides: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: `01a1faf8-0000-7000-8000-${String(1000 - seq).padStart(12, '0')}`,
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
    ...overrides,
  }
}

const rub = (expense: number, income: number) => ({ currency: 'RUB', expense, income })

describe('mergeDays', () => {
  it('объединяет итоги дней всех страниц', () => {
    const days = mergeDays([
      { days: [{ date: '2026-11-23', totals: [rub(100, 0)] }] },
      { days: [{ date: '2026-11-22', totals: [rub(50, 10)] }] },
    ])
    expect([...days.keys()]).toEqual(['2026-11-23', '2026-11-22'])
    expect(days.get('2026-11-22')).toEqual([rub(50, 10)])
  })

  it('день на границе страниц — итог более поздней страницы', () => {
    const days = mergeDays([
      { days: [{ date: '2026-11-22', totals: [rub(100, 0)] }] },
      { days: [{ date: '2026-11-22', totals: [rub(150, 0)] }] },
    ])
    expect(days.get('2026-11-22')).toEqual([rub(150, 0)])
  })

  it('нет страниц — пусто', () => {
    expect(mergeDays([]).size).toBe(0)
  })
})

describe('groupByDay', () => {
  it('соседние операции одной даты — одна группа, порядок сохраняется', () => {
    const a = tx('2026-11-23')
    const b = tx('2026-11-23')
    const c = tx('2026-11-21')
    const days = new Map([
      ['2026-11-23', [rub(200, 0)]],
      ['2026-11-21', [rub(100, 0)]],
    ])
    expect(groupByDay([a, b, c], days)).toEqual([
      { date: '2026-11-23', items: [a, b], totals: [rub(200, 0)] },
      { date: '2026-11-21', items: [c], totals: [rub(100, 0)] },
    ])
  })

  it('день, разрезанный страницей, остаётся одной группой с итогом сервера', () => {
    // Страница 1 кончилась на операции 22-го, страница 2 начинается с 22-го.
    const page1 = {
      items: [tx('2026-11-23'), tx('2026-11-22')],
      days: [
        { date: '2026-11-23', totals: [rub(100, 0)] },
        { date: '2026-11-22', totals: [rub(200, 0)] },
      ],
    }
    const page2 = {
      items: [tx('2026-11-22'), tx('2026-11-20')],
      days: [
        { date: '2026-11-22', totals: [rub(200, 0)] },
        { date: '2026-11-20', totals: [rub(100, 0)] },
      ],
    }
    const groups = groupByDay([...page1.items, ...page2.items], mergeDays([page1, page2]))
    expect(groups.map((g) => [g.date, g.items.length, g.totals])).toEqual([
      ['2026-11-23', 1, [rub(100, 0)]],
      ['2026-11-22', 2, [rub(200, 0)]],
      ['2026-11-20', 1, [rub(100, 0)]],
    ])
  })

  it('итога дня нет — пустой список', () => {
    expect(groupByDay([tx('2026-11-23')], new Map())[0].totals).toEqual([])
  })

  it('пустая лента — нет групп', () => {
    expect(groupByDay([], new Map())).toEqual([])
  })
})

describe('totalAmounts', () => {
  it('расход со знаком минус, доход — плюс, нули пропускаются, по валютам', () => {
    expect(
      totalAmounts([
        { currency: 'RUB', expense: 1500, income: 0 },
        { currency: 'USD', expense: 200, income: 5000 },
        { currency: 'EUR', expense: 0, income: 0 },
      ]),
    ).toEqual([
      { currency: 'RUB', amount: -1500 },
      { currency: 'USD', amount: -200 },
      { currency: 'USD', amount: 5000 },
    ])
  })
})

describe('compareFeedOrder', () => {
  it('дата по убыванию, затем id по убыванию', () => {
    const older = tx('2026-11-22')
    const first = tx('2026-11-23')
    const second = tx('2026-11-23')
    // second создан позже — id меньше в этой фикстуре, значит он ниже first.
    expect([older, second, first].sort(compareFeedOrder)).toEqual([first, second, older])
  })
})

describe('summaryStats', () => {
  it('расходы, доходы и разница', () => {
    expect(summaryStats({ currency: 'RUB', expense: 1500, income: 5000 })).toEqual([
      { key: 'expense', amount: -1500 },
      { key: 'income', amount: 5000 },
      { key: 'difference', amount: 3500 },
    ])
  })

  it('нули скрыты, разница без пары не показывается', () => {
    expect(summaryStats({ currency: 'USD', expense: 1250, income: 0 })).toEqual([
      { key: 'expense', amount: -1250 },
    ])
    expect(summaryStats({ currency: 'USD', expense: 0, income: 0 })).toEqual([])
  })
})
