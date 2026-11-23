import { notifications } from '@mantine/notifications'
import { useQueryClient, type Mutation } from '@tanstack/react-query'

import {
  apiErrorText,
  useDeleteTransaction,
  useRestoreTransaction,
  type Transaction,
} from '../../shared/api'
import { useT } from '../../shared/i18n'
import { notifyWithUndo } from '../../shared/ui'
import {
  cancelFeedFetches,
  invalidateTransactionData,
  patchFeeds,
  withoutTransaction,
  withTransaction,
} from './feedCache'

/**
 * Очередь изменений операций (как у счетов и категорий, handoff 5.5): мутации одного
 * `scope` TanStack Query выполняет строго по одной, в порядке вызова. «Отменить» не обгонит
 * удаление, которое отменяет, а два быстрых удаления не перепутаются на сервере.
 */
const SCOPE = { id: 'transactions' }

const inScope = (m: Mutation<unknown, unknown, unknown, unknown>) =>
  m.options.scope?.id === SCOPE.id

/**
 * Удаление операции с отменой (ux.md, принцип 4: отмена вместо подтверждения).
 *
 * Строка исчезает из ленты сразу (оптимистично). Итоги дня и выборки, остатки счетов
 * и умные значения быстрого ввода зависят от сервера — они обновляются перезапросом после
 * ответа, когда завершилась последняя мутация очереди: перезапрос посреди очереди вернул бы
 * на экран операцию, удаление которой ещё не дошло до сервера.
 */
export function useTransactionActions() {
  const t = useT()
  const qc = useQueryClient()
  const mutation = {
    scope: SCOPE,
    // Вызывается, пока сама мутация ещё в счёте `isMutating`: 1 — она последняя в очереди.
    onSettled: () => {
      if (qc.isMutating({ predicate: inScope }) <= 1) return invalidateTransactionData(qc)
    },
  }
  const deleteMutation = useDeleteTransaction({ mutation })
  const restoreMutation = useRestoreTransaction({ mutation })

  /** Отмена удаления: строка возвращается сразу, сервер восстанавливает операцию. */
  const restore = (transaction: Transaction) => {
    cancelFeedFetches(qc)
    patchFeeds(qc, (data) => withTransaction(data, transaction))
    restoreMutation.mutateAsync({ transactionId: transaction.id }).catch((error: unknown) => {
      patchFeeds(qc, (data) => withoutTransaction(data, transaction.id))
      notifications.show({
        color: 'red',
        title: t.feed.toasts.restoreFailed,
        message: apiErrorText(error, t),
      })
    })
  }

  const remove = (transaction: Transaction) => {
    cancelFeedFetches(qc)
    patchFeeds(qc, (data) => withoutTransaction(data, transaction.id))

    let toastId: string | undefined
    const done = deleteMutation.mutateAsync({ transactionId: transaction.id }).then(
      () => true,
      (error: unknown) => {
        // Откат: строка возвращается на своё место, тост «Отменить» больше не нужен.
        patchFeeds(qc, (data) => withTransaction(data, transaction))
        if (toastId) notifications.hide(toastId)
        notifications.show({ color: 'red', message: apiErrorText(error, t) })
        return false
      },
    )

    toastId = notifyWithUndo({
      message: t.feed.toasts.deleted,
      onUndo: () => {
        void done.then((ok) => {
          if (ok) restore(transaction)
        })
      },
    })
    return done
  }

  return { remove }
}

/** Можно ли удалить: видны все счета операции; корректировку — всегда (docs/api.md). */
export function canDelete(transaction: Transaction): boolean {
  return transaction.editable || transaction.kind === 'adjustment'
}
