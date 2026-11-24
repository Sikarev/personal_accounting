import type { Account } from '../../api'

// Счета для историй Storybook (AccountPicker, AccountMark). В приложение не попадают:
// импортируются только из *.stories.tsx.

let seq = 0

export function storyAccount(overrides: Partial<Account> = {}): Account {
  seq += 1
  return {
    id: `story-${seq}`,
    name: `Счёт ${seq}`,
    type: 'card',
    currency: 'RUB',
    visibility: 'shared',
    initialBalance: 0,
    balance: 0,
    includeInTotal: true,
    color: null,
    sortOrder: seq,
    archivedAt: null,
    hasTransactions: true,
    // Фикстуры в рублях (базовой валюте): эквивалент равен остатку.
    baseBalance: overrides.balance ?? 0,
    ...overrides,
  }
}

export const storyAccounts: Account[] = [
  storyAccount({ name: 'Карта Сбер', color: 'green', balance: 1_234_567 }),
  storyAccount({ name: 'Наличные', type: 'cash', balance: 500_000 }),
  storyAccount({ name: 'Кредитка', type: 'credit_card', color: 'red', balance: -1_500_000 }),
  storyAccount({ name: 'Вклад', type: 'deposit', color: 'yellow', balance: 30_000_000 }),
  storyAccount({ name: 'Доллары', currency: 'USD', visibility: 'private', balance: 5_000 }),
  storyAccount({
    name: 'Заначка',
    type: 'other',
    visibility: 'private',
    color: 'violet',
    balance: -1_000,
  }),
  storyAccount({ name: 'Старая карта', archivedAt: '2026-11-01T10:00:00Z', balance: 0 }),
]
