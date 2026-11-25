import type { Account, Currency } from '../api'
import { getMinorUnits } from './money'

/** Счета одной группы видимости в порядке пользователя (`sortOrder`). */
export type AccountGroups = { shared: Account[]; private: Account[] }

function bySortOrder(a: Account, b: Account) {
  return a.sortOrder - b.sortOrder
}

/**
 * Активные счета по группам «Общие» и «Личные», каждая в порядке `sortOrder`.
 * Сортировка стабильная: при равных номерах сохраняется порядок ответа сервера
 * (у него следующий ключ — момент создания).
 */
export function groupActiveAccounts(accounts: readonly Account[]): AccountGroups {
  const active = accounts.filter((a) => a.archivedAt === null).sort(bySortOrder)
  return {
    shared: active.filter((a) => a.visibility === 'shared'),
    private: active.filter((a) => a.visibility === 'private'),
  }
}

/** Архивные счета обеих групп: сначала общие, затем личные, внутри — по `sortOrder`. */
export function archivedAccounts(accounts: readonly Account[]): Account[] {
  return accounts
    .filter((a) => a.archivedAt !== null)
    .sort((a, b) =>
      a.visibility === b.visibility ? bySortOrder(a, b) : a.visibility === 'shared' ? -1 : 1,
    )
}

/**
 * Базовая валюта семьи — в ней общий баланс и эквиваленты (`Account.baseBalance`).
 * В MVP всегда рубли (requirements 5.9): отдельного поля в `Me` нет.
 */
export const BASE_CURRENCY = 'RUB'

/** Итог по одной валюте в её минимальных единицах. `bigint`: сумма может быть больше 2^53. */
export type CurrencyTotal = { currency: string; amount: bigint }

export type BalanceSummary = {
  /**
   * Общий баланс в минимальных единицах базовой валюты: Σ `baseBalance` активных счетов
   * «в общем балансе», у которых курс есть.
   */
  total: bigint
  /**
   * Валюты (кроме базовой), вошедшие в `total` по курсу ЦБ, — итоги в исходной валюте.
   * Непусто — `total` приблизительный. Валюта с нулевым итогом не показывается.
   */
  converted: CurrencyTotal[]
  /**
   * Валюты без единого курса (`baseBalance: null`): в `total` не вошли, итоги — в исходной
   * валюте, чтобы деньги не «пропадали». Валюта с нулевым итогом не показывается.
   */
  withoutRate: CurrencyTotal[]
}

/**
 * Общий баланс (ux.md, «Главная»: одна главная мысль — сколько у меня денег): сумма
 * `baseBalance` активных счетов с «учитывать в общем балансе». Курс и округление — на
 * сервере (по последнему курсу ЦБ на «сегодня»), здесь только сложение — в BigInt,
 * без потери точности на суммах больше 2^53. Итоги валют — по коду.
 */
export function balanceSummary(accounts: readonly Account[]): BalanceSummary {
  let total = 0n
  const converted = new Map<string, bigint>()
  const withoutRate = new Map<string, bigint>()
  for (const a of accounts) {
    if (a.archivedAt !== null || !a.includeInTotal) continue
    if (a.baseBalance === null) {
      withoutRate.set(a.currency, (withoutRate.get(a.currency) ?? 0n) + BigInt(a.balance))
      continue
    }
    total += BigInt(a.baseBalance)
    if (a.currency !== BASE_CURRENCY) {
      converted.set(a.currency, (converted.get(a.currency) ?? 0n) + BigInt(a.balance))
    }
  }
  return { total, converted: nonZeroByCode(converted), withoutRate: nonZeroByCode(withoutRate) }
}

function nonZeroByCode(sums: Map<string, bigint>): CurrencyTotal[] {
  return [...sums]
    .filter(([, amount]) => amount !== 0n)
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

/**
 * Эквивалент остатка в базовой валюте под суммой валютного счёта (ux.md, «Деньги»).
 * У счёта в базовой валюте и у валюты без курса эквивалента нет — `null`.
 */
export function baseEquivalent(account: Pick<Account, 'currency' | 'baseBalance'>): number | null {
  return account.currency === BASE_CURRENCY ? null : account.baseBalance
}

/**
 * Отрицательный остаток — проблема, которую стоит подсветить, кроме кредитной карты:
 * у неё минус — обычное состояние (ux.md, «Спокойный интерфейс»).
 */
export function isNegativeBalanceProblem(account: Pick<Account, 'type' | 'balance'>): boolean {
  return account.balance < 0 && account.type !== 'credit_card'
}

/** Знаков после запятой у валюты: из справочника `GET /currencies`, иначе по ISO 4217. */
export function minorUnitsOf(currency: string, currencies: readonly Currency[]): number {
  return currencies.find((c) => c.code === currency)?.minorUnits ?? getMinorUnits(currency)
}
