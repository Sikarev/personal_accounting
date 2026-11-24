import { notifications } from '@mantine/notifications'
import { MutationObserver, type QueryClient } from '@tanstack/react-query'

import {
  apiErrorText,
  deleteTransaction,
  type Account,
  type Category,
  type Currency,
  type Transaction,
} from '../../shared/api'
import type { Messages } from '../../shared/i18n'
import { minorUnitsOf } from '../../shared/lib/accounts'
import { formatMoney } from '../../shared/lib/money'
import { notifyWithUndo } from '../../shared/ui'
import { invalidateWhenQueueSettles, TRANSACTIONS_SCOPE } from './transactionsCache'

/**
 * Отменить только что созданную операцию (кнопка «Отменить» в тосте): `DELETE` и сброс
 * кэша. Вызывается и после того, как форма или окно уже закрыты, поэтому — не хук мутации
 * (колбэки хука после размонтирования не вызываются), а `MutationObserver` без компонента:
 * так `DELETE` встаёт в общую очередь изменений операций (`TRANSACTIONS_SCOPE`).
 * Ошибка — тост с текстом по коду (`apiErrorText`) и заголовком `failedTitle`.
 */
export function undoTransaction(
  qc: QueryClient,
  transactionId: string,
  t: Messages,
  failedTitle: string,
): Promise<void> {
  const observer = new MutationObserver(qc, {
    mutationFn: (id: string) => deleteTransaction(id),
    scope: TRANSACTIONS_SCOPE,
    // Сброс кэша — после последней мутации очереди, как у остальных изменений операций.
    onSettled: () => invalidateWhenQueueSettles(qc),
  })
  return (
    observer
      .mutate(transactionId)
      .then(
        () => undefined,
        (error: unknown) => {
          notifications.show({ color: 'red', title: failedTitle, message: apiErrorText(error, t) })
        },
      )
      // Наблюдатель без компонента сам не отписывается — мутация осталась бы в кэше навсегда.
      .finally(() => observer.reset())
  )
}

/** Текст тоста после создания: «Расход 590 ₽ · Продукты», «Перевод 1 000 ₽ · Карта → Наличные». */
export function createdToastText(
  transaction: Transaction,
  data: {
    accounts: readonly Account[]
    categories: readonly Category[]
    currencies: readonly Currency[]
  },
  t: Messages,
): string {
  const amount =
    transaction.amount !== null && transaction.currency !== null
      ? formatMoney(transaction.amount, transaction.currency, {
          minorUnits: minorUnitsOf(transaction.currency, data.currencies),
        })
      : ''
  const accountName = (id: string | null) => data.accounts.find((a) => a.id === id)?.name ?? ''
  if (transaction.kind === 'transfer') {
    return t.transactions.toasts.transfer(
      amount,
      accountName(transaction.accountId),
      accountName(transaction.toAccountId),
    )
  }
  const category = data.categories.find((c) => c.id === transaction.categoryId)?.name ?? ''
  return transaction.kind === 'income'
    ? t.transactions.toasts.income(amount, category)
    : t.transactions.toasts.expense(amount, category)
}

/** Тост «Расход 590 ₽ · Продукты · Отменить» после создания операции. */
export function notifyTransactionCreated(
  qc: QueryClient,
  transaction: Transaction,
  data: {
    accounts: readonly Account[]
    categories: readonly Category[]
    currencies: readonly Currency[]
  },
  t: Messages,
): string {
  return notifyWithUndo({
    message: createdToastText(transaction, data, t),
    onUndo: () => void undoTransaction(qc, transaction.id, t, t.transactions.toasts.undoFailed),
  })
}
