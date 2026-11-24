import type { Category, Transaction } from '../../api'
import type { Messages } from '../../i18n'
import { CATEGORY_PATH_SEPARATOR } from '../../lib/categoryTree'

/** Что показать в строке операции: вычисляется из операции и справочников. */
export type TransactionView = {
  /** Название: имя категории с родителем (у подкатегории) или готовый текст. */
  title: { parent: string | null; name: string }
  /** Сумма справа; `flow` — со знаком и цветом движения денег (расход, доход). */
  amount: { value: number; currency: string; flow: boolean } | null
  /** Мелко под суммой: счёт или сумма зачисления при обмене валют. */
  side:
    { type: 'account'; name: string } | { type: 'amount'; value: number; currency: string } | null
}

export type TransactionLookups = {
  /**
   * Названия счетов по id; `null` — счета ещё не загружены (или не загрузились): подпись
   * счёта не показывается, а не «Счёт недоступен».
   */
  accountNames: ReadonlyMap<string, string> | null
  categories: ReadonlyMap<string, Category>
}

function amountOf(value: number | null, currency: string | null, flow: boolean) {
  return value === null || currency === null ? null : { value, currency, flow }
}

export function describeTransaction(
  tx: Transaction,
  { accountNames, categories }: TransactionLookups,
  t: Messages,
): TransactionView {
  const accountName = (id: string | null) =>
    (id !== null && accountNames?.get(id)) || t.feed.row.unknownAccount
  const account = (id: string | null) =>
    accountNames ? { type: 'account' as const, name: accountName(id) } : null

  if (tx.kind === 'transfer') {
    // Скрытая сторона (чужой личный счёт): вместо неё — владелец счёта.
    const counterparty = tx.counterparty?.name ?? t.feed.row.deletedAuthor
    if (tx.accountId === null) {
      return {
        title: { parent: null, name: t.feed.row.incomingFrom(counterparty) },
        amount: amountOf(tx.toAmount, tx.toCurrency, false),
        side: account(tx.toAccountId),
      }
    }
    if (tx.toAccountId === null) {
      return {
        title: { parent: null, name: t.feed.row.outgoingTo(counterparty) },
        amount: amountOf(tx.amount, tx.currency, false),
        side: account(tx.accountId),
      }
    }
    // Обмен валют — обе суммы: списание крупно, зачисление мелко под ним.
    const exchange = tx.toCurrency !== null && tx.toAmount !== null && tx.toCurrency !== tx.currency
    return {
      title: {
        parent: null,
        name: accountNames
          ? `${accountName(tx.accountId)} → ${accountName(tx.toAccountId)}`
          : t.transactions.kinds.transfer,
      },
      amount: amountOf(tx.amount, tx.currency, false),
      side: exchange ? { type: 'amount', value: tx.toAmount!, currency: tx.toCurrency! } : null,
    }
  }

  if (tx.kind === 'adjustment') {
    // У корректировки `amount` уже со знаком (особенность API): передаём как есть.
    return {
      title: { parent: null, name: t.feed.row.adjustment },
      amount: amountOf(tx.amount, tx.currency, true),
      side: account(tx.accountId),
    }
  }

  const category = tx.categoryId !== null ? categories.get(tx.categoryId) : undefined
  const parent = category?.parentId ? categories.get(category.parentId) : undefined
  const sign = tx.kind === 'expense' ? -1 : 1
  return {
    title: category
      ? { parent: parent?.name ?? null, name: category.name }
      : { parent: null, name: t.feed.row.noCategory },
    amount: tx.amount === null ? null : amountOf(sign * tx.amount, tx.currency, true),
    side: account(tx.accountId),
  }
}

/** Название операции текстом: «Продукты › Молочное», «Карта → Наличные». */
export function transactionTitle(
  tx: Transaction,
  lookups: TransactionLookups,
  t: Messages,
): string {
  const { parent, name } = describeTransaction(tx, lookups, t).title
  return parent ? `${parent}${CATEGORY_PATH_SEPARATOR}${name}` : name
}
