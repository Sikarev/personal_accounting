import { describe, expect, it } from 'vitest'

import type { Account } from '../api'
import {
  archivedAccounts,
  balanceSummary,
  baseEquivalent,
  groupActiveAccounts,
  isNegativeBalanceProblem,
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
    // Фикстуры в рублях (базовой валюте): эквивалент равен остатку.
    baseBalance: overrides.balance ?? 0,
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

// Курс в фикстурах: 1 $ = 92,35 ₽, 1 € = 100,50 ₽ (как отдаёт сервер — уже округлено).
const usd = (balance: number) =>
  account({ currency: 'USD', balance, baseBalance: Math.round(balance * 92.35) })
const eur = (balance: number) =>
  account({ currency: 'EUR', balance, baseBalance: Math.round(balance * 100.5) })

describe('balanceSummary', () => {
  it('только рубли: сумма остатков, без разбивки по валютам', () => {
    expect(balanceSummary([account({ balance: 100_000 }), account({ balance: 2_050 })])).toEqual({
      total: 102_050n,
      converted: [],
      withoutRate: [],
    })
  })

  it('рубли и доллары: итог в рублях, доллары — в разбивке в исходной валюте', () => {
    expect(
      balanceSummary([account({ balance: 100_000 }), usd(50_000), usd(10_000), eur(1_000)]),
    ).toEqual({
      total: 100_000n + 4_617_500n + 923_500n + 100_500n,
      converted: [
        { currency: 'EUR', amount: 1_000n },
        { currency: 'USD', amount: 60_000n },
      ],
      withoutRate: [],
    })
  })

  it('доллары без курса: в итог не входят, итог долларов — отдельно', () => {
    expect(
      balanceSummary([
        account({ balance: 100_000 }),
        account({ currency: 'USD', balance: 50_000, baseBalance: null }),
        account({ currency: 'USD', balance: 1_000, baseBalance: null }),
        eur(1_000),
      ]),
    ).toEqual({
      total: 200_500n,
      converted: [{ currency: 'EUR', amount: 1_000n }],
      withoutRate: [{ currency: 'USD', amount: 51_000n }],
    })
  })

  it('не учитывает архивные и исключённые из общего баланса', () => {
    expect(
      balanceSummary([
        account({ balance: 100 }),
        account({ balance: 1_000, includeInTotal: false }),
        account({ balance: 10_000, archivedAt: '2026-11-20T10:00:00Z' }),
        { ...usd(5_000), includeInTotal: false },
        { ...usd(5_000), archivedAt: '2026-11-20T10:00:00Z' },
        account({ currency: 'EUR', balance: 7, baseBalance: null, includeInTotal: false }),
      ]),
    ).toEqual({ total: 100n, converted: [], withoutRate: [] })
  })

  it('отрицательные остатки — со знаком; нулевой итог валюты не показывается', () => {
    expect(
      balanceSummary([
        account({ balance: -3_000_000, type: 'credit_card' }),
        usd(-1_000),
        usd(500),
        eur(200),
        eur(-200),
      ]),
    ).toEqual({
      total: -3_000_000n - 92_350n + 46_175n + 20_100n - 20_100n,
      converted: [{ currency: 'USD', amount: -500n }],
      withoutRate: [],
    })
  })

  it('сумма больше 2^53 не теряет точность', () => {
    const big = Number.MAX_SAFE_INTEGER // 2^53 − 1
    expect(balanceSummary([account({ balance: big }), account({ balance: 2 })]).total).toBe(
      BigInt(big) + 2n,
    )
  })

  it('нет счетов — ноль', () => {
    expect(balanceSummary([])).toEqual({ total: 0n, converted: [], withoutRate: [] })
  })
})

describe('baseEquivalent', () => {
  it('у валютного счёта — baseBalance, у рублёвого и без курса — нет', () => {
    expect(baseEquivalent({ currency: 'USD', baseBalance: -4_617_500 })).toBe(-4_617_500)
    expect(baseEquivalent({ currency: 'USD', baseBalance: null })).toBeNull()
    expect(baseEquivalent({ currency: 'RUB', baseBalance: 100 })).toBeNull()
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
