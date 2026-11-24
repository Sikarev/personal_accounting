import type {
  Account,
  Currency,
  Transaction,
  TransactionDefaults,
  TransactionRequest,
} from '../../shared/api'
import type { Messages } from '../../shared/i18n'
import { groupActiveAccounts, minorUnitsOf } from '../../shared/lib/accounts'
import { evaluateAmount } from '../../shared/lib/amountExpression'
import { formatMoneyInput } from '../../shared/lib/moneyInput'

/**
 * Состояние формы операции и его перевод в тело запроса — без React, чтобы правила
 * (значения по умолчанию, что сохраняется после «Сохранить», проверка) было легко проверить.
 */

export type TransactionFormKind = 'expense' | 'income' | 'transfer'

export const FORM_KINDS: readonly TransactionFormKind[] = ['expense', 'income', 'transfer']

export type TransactionFormValues = {
  kind: TransactionFormKind
  /**
   * Счёт у каждого вида свой: переключение «Расход → Доход» берёт счёт последнего дохода,
   * а не уносит счёт расхода. Перевод — пара «откуда → куда».
   */
  expenseAccountId: string | null
  incomeAccountId: string | null
  fromAccountId: string | null
  toAccountId: string | null
  date: string
  /** Текст поля суммы как есть — число или выражение. */
  amount: string
  /** Сумма зачисления — только у перевода между валютами. */
  toAmount: string
  categoryId: string | null
  comment: string
}

/** Поля формы, у которых ошибка показывается прямо под полем. */
export const INLINE_FIELDS = ['amount', 'toAmount', 'categoryId', 'comment'] as const

/** Поля, ошибка которых показывается под строкой «Счёт · Дата» (у них своего места нет). */
export const ROW_FIELDS = ['accountId', 'toAccountId', 'date', 'kind'] as const

/** Активные счета в порядке экрана «Счета»: сначала общие, затем личные. */
export function activeAccountsInOrder(accounts: readonly Account[]): Account[] {
  const groups = groupActiveAccounts(accounts)
  return [...groups.shared, ...groups.private]
}

function pickAccount(active: readonly Account[], preferred: string | null | undefined) {
  if (preferred && active.some((a) => a.id === preferred)) return preferred
  return active[0]?.id ?? null
}

/**
 * Начальные значения. Создание: счета — из `defaults` (последние использованные), если
 * они ещё активны, иначе первый по порядку экрана «Счета»; дата — сегодня. Правка: всё из
 * операции, остальные виды — как при создании (на случай смены вида).
 */
export function initialValues({
  accounts,
  defaults,
  currencies,
  today,
  transaction,
}: {
  accounts: readonly Account[]
  defaults: TransactionDefaults | null | undefined
  currencies: readonly Currency[]
  today: string
  transaction?: Transaction | null
}): TransactionFormValues {
  const active = activeAccountsInOrder(accounts)
  const fromAccountId = pickAccount(active, defaults?.transfer?.accountId)
  const toAccountId = pickAccount(
    active.filter((a) => a.id !== fromAccountId),
    defaults?.transfer?.toAccountId,
  )

  const values: TransactionFormValues = {
    kind: 'expense',
    expenseAccountId: pickAccount(active, defaults?.expenseAccountId),
    incomeAccountId: pickAccount(active, defaults?.incomeAccountId),
    fromAccountId,
    toAccountId,
    date: today,
    amount: '',
    toAmount: '',
    categoryId: null,
    comment: '',
  }
  if (!transaction || transaction.kind === 'adjustment') return values

  const amountText = (amount: number | null, currency: string | null) =>
    amount === null || currency === null
      ? ''
      : formatMoneyInput(amount, minorUnitsOf(currency, currencies))

  values.kind = transaction.kind
  values.date = transaction.date
  values.amount = amountText(transaction.amount, transaction.currency)
  values.comment = transaction.comment
  // Смена вида при правке — счёт остаётся счётом правимой операции (у перевода — «Откуда»),
  // а не последним из defaults: пользователь исправляет эту операцию, а не вносит новую.
  values.expenseAccountId = transaction.accountId
  values.incomeAccountId = transaction.accountId
  values.fromAccountId = transaction.accountId
  if (transaction.kind === 'transfer') {
    values.toAccountId = transaction.toAccountId
    if (transaction.currency !== transaction.toCurrency) {
      values.toAmount = amountText(transaction.toAmount, transaction.toCurrency)
    }
  } else {
    values.categoryId = transaction.categoryId
    // «Куда» для возможного перевода — любой другой активный счёт.
    if (values.toAccountId === transaction.accountId) {
      values.toAccountId = active.find((a) => a.id !== transaction.accountId)?.id ?? null
    }
  }
  return values
}

/**
 * Почему операцию нельзя изменить в форме, или `null`, если можно: корректировку остатка
 * не правят (только удаляют), а перевод со скрытым чужим личным счётом правит только
 * владелец того счёта (`editable: false`).
 */
export function readonlyReason(
  transaction: Transaction | null | undefined,
): 'adjustment' | 'notEditable' | null {
  if (!transaction) return null
  if (transaction.kind === 'adjustment') return 'adjustment'
  if (!transaction.editable) return 'notEditable'
  return null
}

/**
 * После сохранения новой операции: вид, счета и дата остаются (удобно вносить пачку
 * чеков за вчера), сумма, категория и комментарий очищаются.
 */
export function clearedAfterCreate(values: TransactionFormValues): TransactionFormValues {
  return { ...values, amount: '', toAmount: '', categoryId: null, comment: '' }
}

/** Счёт списания текущего вида. */
export function sourceAccountId(values: TransactionFormValues): string | null {
  if (values.kind === 'expense') return values.expenseAccountId
  if (values.kind === 'income') return values.incomeAccountId
  return values.fromAccountId
}

/** Перевод между счетами в разных валютах — нужна вторая сумма. */
export function isExchange(
  values: TransactionFormValues,
  accounts: readonly Account[],
): { from: Account; to: Account } | null {
  if (values.kind !== 'transfer') return null
  const from = accounts.find((a) => a.id === values.fromAccountId)
  const to = accounts.find((a) => a.id === values.toAccountId)
  if (!from || !to || from.currency === to.currency) return null
  return { from, to }
}

export type BuildResult =
  { ok: true; body: TransactionRequest } | { ok: false; errors: Record<string, string> }

/** Проверка на клиенте и тело `POST`/`PUT /transactions`. Ключи ошибок — поля API. */
export function buildRequest(
  values: TransactionFormValues,
  accounts: readonly Account[],
  currencies: readonly Currency[],
  t: Messages,
): BuildResult {
  const errors: Record<string, string> = {}
  const accountId = sourceAccountId(values)
  const account = accounts.find((a) => a.id === accountId)

  if (!account) errors.accountId = t.accounts.picker.title
  if (values.kind === 'transfer') {
    if (!values.toAccountId) errors.toAccountId = t.accounts.picker.title
    else if (values.toAccountId === accountId) errors.toAccountId = t.errors.field.sameAccount
  }

  const amount = evaluateAmount(
    values.amount,
    account ? minorUnitsOf(account.currency, currencies) : 2,
    t,
  )
  if (!amount.ok) {
    errors.amount = amount.code === 'empty' ? t.amountInput.required : amount.message
  }

  let toAmount: number | undefined
  const exchange = isExchange(values, accounts)
  if (exchange) {
    const parsed = evaluateAmount(
      values.toAmount,
      minorUnitsOf(exchange.to.currency, currencies),
      t,
    )
    if (parsed.ok) toAmount = parsed.value
    else
      errors.toAmount =
        parsed.code === 'empty' ? t.transactions.errors.toAmountRequired : parsed.message
  }

  if (values.kind !== 'transfer' && !values.categoryId) {
    errors.categoryId = t.transactions.errors.categoryRequired
  }

  if (Object.keys(errors).length > 0 || !amount.ok || !accountId) return { ok: false, errors }

  const body: TransactionRequest = {
    kind: values.kind,
    date: values.date,
    accountId,
    amount: amount.value,
    // Всегда, даже пустой: при правке пустая строка стирает прежний комментарий.
    comment: values.comment.trim(),
  }
  if (values.kind === 'transfer') {
    body.toAccountId = values.toAccountId
    if (toAmount !== undefined) body.toAmount = toAmount
  } else {
    body.categoryId = values.categoryId
  }
  return { ok: true, body }
}
