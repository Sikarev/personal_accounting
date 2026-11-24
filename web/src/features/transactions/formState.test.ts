import { describe, expect, it } from 'vitest'

import type { Account, Transaction, TransactionDefaults } from '../../shared/api'
import { ru as t } from '../../shared/i18n/ru'
import {
  buildRequest,
  clearedAfterCreate,
  initialValues,
  readonlyReason,
  type TransactionFormValues,
} from './formState'

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    name: id,
    type: 'card',
    currency: 'RUB',
    visibility: 'shared',
    initialBalance: 0,
    balance: 0,
    includeInTotal: true,
    color: null,
    sortOrder: 0,
    archivedAt: null,
    hasTransactions: true,
    // Фикстуры в рублях (базовой валюте): эквивалент равен остатку.
    baseBalance: overrides.balance ?? 0,
    ...overrides,
  }
}

// Порядок экрана «Счета»: общие по sortOrder, затем личные.
const accounts = [
  account('private', { visibility: 'private', sortOrder: 0 }),
  account('card', { sortOrder: 1 }),
  account('cash', { sortOrder: 2 }),
  account('old', { sortOrder: 0, archivedAt: '2026-11-01T00:00:00Z' }),
  account('usd', { currency: 'USD', sortOrder: 3 }),
]
const currencies = [
  { code: 'RUB', name: 'Рубль', symbol: '₽', minorUnits: 2 },
  { code: 'USD', name: 'Доллар', symbol: '$', minorUnits: 2 },
]
const today = '2026-11-23'

const defaults: TransactionDefaults = {
  expenseAccountId: 'cash',
  incomeAccountId: 'old', // архивный — не подходит
  transfer: { accountId: 'card', toAccountId: 'usd' },
  frequentCategories: { expense: [], income: [] },
}

describe('initialValues', () => {
  it('без умных значений — первый счёт по порядку экрана «Счета», дата — сегодня', () => {
    expect(initialValues({ accounts, defaults: null, currencies, today })).toEqual({
      kind: 'expense',
      expenseAccountId: 'card',
      incomeAccountId: 'card',
      fromAccountId: 'card',
      toAccountId: 'cash',
      date: today,
      amount: '',
      toAmount: '',
      categoryId: null,
      comment: '',
    })
  })

  it('умные значения — если счёт ещё активен', () => {
    const values = initialValues({ accounts, defaults, currencies, today })
    expect(values.expenseAccountId).toBe('cash')
    expect(values.incomeAccountId).toBe('card')
    expect([values.fromAccountId, values.toAccountId]).toEqual(['card', 'usd'])
  })

  it('правка — значения операции', () => {
    const transaction: Transaction = {
      id: 'tx',
      kind: 'transfer',
      date: '2026-11-20',
      accountId: 'card',
      amount: 923_550,
      currency: 'RUB',
      toAccountId: 'usd',
      toAmount: 10_000,
      toCurrency: 'USD',
      categoryId: null,
      comment: 'Обмен',
      author: null,
      counterparty: null,
      editable: true,
      createdAt: '',
      updatedAt: '',
    }
    expect(initialValues({ accounts, defaults, currencies, today, transaction })).toMatchObject({
      kind: 'transfer',
      date: '2026-11-20',
      fromAccountId: 'card',
      toAccountId: 'usd',
      amount: '9235,5',
      toAmount: '100',
      comment: 'Обмен',
    })
  })
})

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx',
    kind: 'expense',
    date: '2026-11-20',
    accountId: 'cash',
    amount: 59_000,
    currency: 'RUB',
    toAccountId: null,
    toAmount: null,
    toCurrency: null,
    categoryId: 'food',
    comment: '',
    author: null,
    counterparty: null,
    editable: true,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('initialValues: правка и смена вида', () => {
  it('расход: счёт операции — у всех видов, «Куда» — другой счёт, не из defaults', () => {
    const values = initialValues({
      accounts,
      defaults: { ...defaults, transfer: { accountId: 'usd', toAccountId: 'cash' } },
      currencies,
      today,
      transaction: tx({ accountId: 'cash' }),
    })
    expect(values).toMatchObject({
      kind: 'expense',
      expenseAccountId: 'cash',
      incomeAccountId: 'cash',
      fromAccountId: 'cash',
      amount: '590',
      categoryId: 'food',
    })
    expect(values.toAccountId).not.toBe('cash')
    expect(values.toAccountId).not.toBeNull()
  })

  it('перевод: «Откуда» — счёт операции, он же у расхода и дохода', () => {
    const values = initialValues({
      accounts,
      defaults,
      currencies,
      today,
      transaction: tx({
        kind: 'transfer',
        accountId: 'cash',
        toAccountId: 'card',
        toAmount: 59_000,
        toCurrency: 'RUB',
        categoryId: null,
      }),
    })
    expect(values).toMatchObject({
      kind: 'transfer',
      fromAccountId: 'cash',
      toAccountId: 'card',
      expenseAccountId: 'cash',
      incomeAccountId: 'cash',
      toAmount: '',
    })
  })
})

describe('initialValues: по образцу (дублирование)', () => {
  const categories = [
    {
      id: 'food',
      kind: 'expense' as const,
      parentId: null,
      name: 'Еда',
      sortOrder: 0,
      archivedAt: null,
    },
    {
      id: 'gone',
      kind: 'expense' as const,
      parentId: null,
      name: 'Старое',
      sortOrder: 1,
      archivedAt: '2026-01-01T00:00:00Z',
    },
  ]

  it('значения образца, дата — сегодня', () => {
    const values = initialValues({
      accounts,
      defaults,
      currencies,
      today,
      categories,
      template: tx({ accountId: 'card', comment: 'Хлеб' }),
    })
    expect(values).toMatchObject({
      kind: 'expense',
      date: today,
      expenseAccountId: 'card',
      amount: '590',
      categoryId: 'food',
      comment: 'Хлеб',
    })
  })

  it('архивные счёт и категория образца не подставляются', () => {
    const values = initialValues({
      accounts,
      defaults,
      currencies,
      today,
      categories,
      template: tx({ accountId: 'old', categoryId: 'gone' }),
    })
    expect(values.expenseAccountId).toBe('cash')
    expect(values.categoryId).toBeNull()
  })

  it('обмен валют — обе суммы', () => {
    const values = initialValues({
      accounts,
      defaults,
      currencies,
      today,
      template: tx({
        kind: 'transfer',
        accountId: 'card',
        amount: 925_000,
        toAccountId: 'usd',
        toAmount: 10_000,
        toCurrency: 'USD',
        categoryId: null,
      }),
    })
    expect(values).toMatchObject({
      kind: 'transfer',
      fromAccountId: 'card',
      toAccountId: 'usd',
      amount: '9250',
      toAmount: '100',
      date: today,
    })
  })
})

describe('readonlyReason', () => {
  it('корректировку и чужой перевод изменить нельзя', () => {
    expect(readonlyReason(null)).toBeNull()
    expect(readonlyReason(tx({}))).toBeNull()
    expect(readonlyReason(tx({ kind: 'adjustment', editable: false }))).toBe('adjustment')
    expect(readonlyReason(tx({ kind: 'transfer', editable: false }))).toBe('notEditable')
  })
})

describe('clearedAfterCreate', () => {
  it('вид, счета и дата остаются; сумма, категория и комментарий очищаются', () => {
    const values: TransactionFormValues = {
      ...initialValues({ accounts, defaults, currencies, today }),
      kind: 'income',
      date: '2026-11-22',
      amount: '590',
      toAmount: '10',
      categoryId: 'salary',
      comment: 'аванс',
    }
    expect(clearedAfterCreate(values)).toEqual({
      ...values,
      amount: '',
      toAmount: '',
      categoryId: null,
      comment: '',
    })
  })
})

describe('buildRequest', () => {
  const base = initialValues({ accounts, defaults: null, currencies, today })

  it('расход: тело запроса, комментарий без пробелов по краям', () => {
    const result = buildRequest(
      { ...base, amount: '350+120*2', categoryId: 'food', comment: '  чек  ' },
      accounts,
      currencies,
      t,
    )
    expect(result).toEqual({
      ok: true,
      body: {
        kind: 'expense',
        date: today,
        accountId: 'card',
        amount: 59000,
        categoryId: 'food',
        comment: 'чек',
      },
    })
  })

  it('пустые сумма и категория — ошибки у полей', () => {
    expect(buildRequest(base, accounts, currencies, t)).toEqual({
      ok: false,
      errors: {
        amount: t.amountInput.required,
        categoryId: t.transactions.errors.categoryRequired,
      },
    })
    expect(
      buildRequest({ ...base, amount: '0', categoryId: 'food' }, accounts, currencies, t),
    ).toEqual({ ok: false, errors: { amount: t.amountInput.notPositive } })
  })

  it('перевод в одной валюте — без toAmount и категории', () => {
    const result = buildRequest(
      { ...base, kind: 'transfer', amount: '1000', toAmount: '5', categoryId: 'food' },
      accounts,
      currencies,
      t,
    )
    expect(result).toEqual({
      ok: true,
      body: {
        kind: 'transfer',
        date: today,
        accountId: 'card',
        toAccountId: 'cash',
        amount: 100000,
        comment: '',
      },
    })
  })

  it('обмен валют — нужна сумма зачисления', () => {
    const exchange = { ...base, kind: 'transfer' as const, toAccountId: 'usd', amount: '9235' }
    expect(buildRequest(exchange, accounts, currencies, t)).toEqual({
      ok: false,
      errors: { toAmount: t.transactions.errors.toAmountRequired },
    })
    expect(buildRequest({ ...exchange, toAmount: '100' }, accounts, currencies, t)).toMatchObject({
      ok: true,
      body: { amount: 923500, toAccountId: 'usd', toAmount: 10000 },
    })
  })

  it('перевод на тот же счёт', () => {
    expect(
      buildRequest(
        { ...base, kind: 'transfer', toAccountId: 'card', amount: '5' },
        accounts,
        currencies,
        t,
      ),
    ).toEqual({ ok: false, errors: { toAccountId: t.errors.field.sameAccount } })
  })
})
