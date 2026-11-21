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

export type CurrencyTotal = { currency: string; amount: number }

/**
 * Итог по активным счетам с «учитывать в общем балансе» — отдельно по каждой валюте:
 * курсов до этапа 4 нет, складывать рубли с долларами нельзя.
 * Порядок: рубли первыми, остальные валюты по коду.
 */
export function totalsByCurrency(accounts: readonly Account[]): CurrencyTotal[] {
  const sums = new Map<string, number>()
  for (const a of accounts) {
    if (a.archivedAt !== null || !a.includeInTotal) continue
    sums.set(a.currency, (sums.get(a.currency) ?? 0) + a.balance)
  }
  return [...sums]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) =>
      a.currency === 'RUB' ? -1 : b.currency === 'RUB' ? 1 : a.currency.localeCompare(b.currency),
    )
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
