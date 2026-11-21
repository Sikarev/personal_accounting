import { describe, expect, it } from 'vitest'

import type { Account } from '../api'
import {
  archivedAccounts,
  groupActiveAccounts,
  isNegativeBalanceProblem,
  totalsByCurrency,
} from './accounts'

let seq = 0
function account(overrides: Partial<Account> = {}): Account {
  seq += 1
  return {
    id: `id-${seq}`,
    name: `Счёт ${seq}`,
    type: 'card',
    currency: 'RUB',
    visibility: 'shared',
    initialBalance: 0,
    balance: 0,
    includeInTotal: true,
    color: null,
    sortOrder: 0,
    archivedAt: null,
    hasTransactions: false,
    ...overrides,
  }
}

describe('groupActiveAccounts', () => {
  it('делит по видимости, убирает архивные, сортирует по sortOrder', () => {
    const a = account({ sortOrder: 2 })
    const b = account({ sortOrder: 0 })
    const c = account({ visibility: 'private', sortOrder: 1 })
    const d = account({ sortOrder: 1, archivedAt: '2026-11-20T10:00:00Z' })
    const groups = groupActiveAccounts([a, b, c, d])
    expect(groups.shared.map((x) => x.id)).toEqual([b.id, a.id])
    expect(groups.private.map((x) => x.id)).toEqual([c.id])
  })

  it('при равных sortOrder сохраняет порядок сервера', () => {
    const a = account({ sortOrder: 1 })
    const b = account({ sortOrder: 1 })
    expect(groupActiveAccounts([a, b]).shared.map((x) => x.id)).toEqual([a.id, b.id])
  })
})

describe('archivedAccounts', () => {
  it('только архивные: сначала общие, затем личные', () => {
    const archived = '2026-11-20T10:00:00Z'
    const p = account({ visibility: 'private', archivedAt: archived })
    const s2 = account({ archivedAt: archived, sortOrder: 5 })
    const s1 = account({ archivedAt: archived, sortOrder: 1 })
    const active = account()
    expect(archivedAccounts([p, s2, active, s1]).map((x) => x.id)).toEqual([s1.id, s2.id, p.id])
  })
})

describe('totalsByCurrency', () => {
  it('суммирует по валютам, рубли первыми', () => {
    const totals = totalsByCurrency([
      account({ currency: 'USD', balance: 5000 }),
      account({ balance: 100000 }),
      account({ balance: -30000, type: 'credit_card' }),
      account({ currency: 'EUR', balance: 100 }),
    ])
    expect(totals).toEqual([
      { currency: 'RUB', amount: 70000 },
      { currency: 'EUR', amount: 100 },
      { currency: 'USD', amount: 5000 },
    ])
  })

  it('не учитывает архивные и исключённые из общего баланса', () => {
    expect(
      totalsByCurrency([
        account({ balance: 100 }),
        account({ balance: 1000, includeInTotal: false }),
        account({ balance: 10000, archivedAt: '2026-11-20T10:00:00Z' }),
      ]),
    ).toEqual([{ currency: 'RUB', amount: 100 }])
  })

  it('нет счетов — пустой список', () => {
    expect(totalsByCurrency([])).toEqual([])
  })
})

describe('isNegativeBalanceProblem', () => {
  it.each([
    ['card', -1, true],
    ['cash', -100, true],
    ['card', 0, false],
    ['card', 100, false],
    ['credit_card', -100000, false],
  ] as const)('%s, %i → %s', (type, balance, expected) => {
    expect(isNegativeBalanceProblem({ type, balance })).toBe(expected)
  })
})
