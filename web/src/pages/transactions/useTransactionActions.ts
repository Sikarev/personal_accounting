import { notifications } from '@mantine/notifications'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'

import {
  invalidateWhenQueueSettles,
  TRANSACTIONS_SCOPE,
} from '../../features/transactions/transactionsCache'
import {
  apiErrorText,
  useDeleteTransaction,
  useRestoreTransaction,
  useUpdateTransaction,
  type Account,
  type Transaction,
  type TransactionRequest,
} from '../../shared/api'
import { useT } from '../../shared/i18n'
import { notifyWithUndo } from '../../shared/ui'
import {
  applyEdit,
  cancelFeedFetches,
  removeFromFeeds,
  replaceInFeeds,
  returnToFeeds,
} from './feedCache'

/**
 * Изменения операций из ленты: удаление с отменой (ux.md, принцип 4: отмена вместо
 * подтверждения) и правка. Мутации — в общей очереди с быстрым вводом (`TRANSACTIONS_SCOPE`):
 * «Отменить» не обгонит удаление, а перезапрос после создания не вернёт строку,
 * удаление которой ещё не дошло до сервера.
 *
 * Строка исчезает (меняется) в ленте сразу — оптимистично. Итоги дня и выборки, остатки счетов
 * и умные значения быстрого ввода зависят от сервера — они обновляются перезапросом после
 * ответа, когда завершилась последняя мутация очереди: перезапрос посреди очереди вернул бы
 * на экран операцию, удаление которой ещё не дошло до сервера.
 */
export function useTransactionActions() {
  const t = useT()
  const qc = useQueryClient()
  const mutation = { scope: TRANSACTIONS_SCOPE, onSettled: () => invalidateWhenQueueSettles(qc) }
  const deleteMutation = useDeleteTransaction({ mutation })
  const restoreMutation = useRestoreTransaction({ mutation })
  const updateMutation = useUpdateTransaction({ mutation })

  /**
   * Правка (решение PM, handoff 5.6): строка в лентах меняется сразу, форма закрывается,
   * не дожидаясь ответа. Ошибка — прежняя версия строки и тост с причиной; изменения
   * при этом не теряются насовсем: их можно ввести заново. «Отменить» в тосте нет —
   * правку отменяют правкой. Возвращает операцию «как будет» — для `onSaved` формы.
   */
  const edit = (
    transaction: Transaction,
    body: TransactionRequest,
    accounts: readonly Account[],
  ): Promise<Transaction> => {
    cancelFeedFetches(qc)
    const optimistic = applyEdit(transaction, body, accounts)
    replaceInFeeds(qc, optimistic)
    updateMutation.mutateAsync({ transactionId: transaction.id, data: body }).then(
      (saved) => void replaceInFeeds(qc, saved),
      (error: unknown) => {
        // Откат — прежняя версия строки в тех же лентах.
        replaceInFeeds(qc, transaction)
        notifications.show({
          color: 'red',
          title: t.feed.toasts.editFailed,
          message: apiErrorText(error, t),
        })
      },
    )
    notifications.show({ message: t.feed.toasts.edited })
    return Promise.resolve(optimistic)
  }

  /**
   * Отмена удаления: строка сразу возвращается в те ленты, откуда ушла (`keys`),
   * сервер восстанавливает операцию.
   */
  const restore = (transaction: Transaction, keys: readonly QueryKey[]) => {
    cancelFeedFetches(qc)
    returnToFeeds(qc, keys, transaction)
    restoreMutation.mutateAsync({ transactionId: transaction.id }).catch((error: unknown) => {
      removeFromFeeds(qc, transaction.id)
      notifications.show({
        color: 'red',
        title: t.feed.toasts.restoreFailed,
        message: apiErrorText(error, t),
      })
    })
  }

  const remove = (transaction: Transaction) => {
    cancelFeedFetches(qc)
    const keys = removeFromFeeds(qc, transaction.id)

    let toastId: string | undefined
    const done = deleteMutation.mutateAsync({ transactionId: transaction.id }).then(
      () => true,
      (error: unknown) => {
        // Откат: строка возвращается на своё место, тост «Отменить» больше не нужен.
        returnToFeeds(qc, keys, transaction)
        if (toastId) notifications.hide(toastId)
        notifications.show({ color: 'red', message: apiErrorText(error, t) })
        return false
      },
    )

    toastId = notifyWithUndo({
      message: t.feed.toasts.deleted,
      onUndo: () => {
        void done.then((ok) => {
          if (ok) restore(transaction, keys)
        })
      },
    })
    return done
  }

  return { remove, edit }
}

/** Дублировать можно расход, доход и перевод между своими счетами (не корректировку). */
export function canDuplicate(transaction: Transaction): boolean {
  return transaction.kind !== 'adjustment' && transaction.editable
}

/** Можно ли удалить: видны все счета операции; корректировку — всегда (docs/api.md). */
export function canDelete(transaction: Transaction): boolean {
  return transaction.editable || transaction.kind === 'adjustment'
}
