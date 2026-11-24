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
  type Transaction,
} from '../../shared/api'
import { useT } from '../../shared/i18n'
import { notifyWithUndo } from '../../shared/ui'
import { cancelFeedFetches, removeFromFeeds, replaceInFeeds, returnToFeeds } from './feedCache'

/**
 * Изменения операций из ленты: удаление с отменой (ux.md, принцип 4: отмена вместо
 * подтверждения) и обновление строки ответом сервера после правки (сама правка ждёт ответа
 * в форме). Мутации — в общей очереди с быстрым вводом (`TRANSACTIONS_SCOPE`): «Отменить»
 * не обгонит удаление, а перезапрос после создания не вернёт строку, удаление которой ещё
 * не дошло до сервера.
 *
 * Удалённая строка исчезает из ленты сразу — оптимистично. Итоги дня и выборки, остатки счетов
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

  /**
   * Правка сохранена (форма ждала ответа сервера — при ошибке введённое не теряется,
   * ux.md §4): строка в лентах — ответом сервера сразу, не дожидаясь перезапроса,
   * тост без «Отменить» — правку отменяют правкой. Кэш сбрасывает сама форма.
   */
  const edited = (saved: Transaction) => {
    replaceInFeeds(qc, saved)
    notifications.show({ message: t.feed.toasts.edited })
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

  return { remove, edited }
}

/** Дублировать можно расход, доход и перевод между своими счетами (не корректировку). */
export function canDuplicate(transaction: Transaction): boolean {
  return transaction.kind !== 'adjustment' && transaction.editable
}

/** Можно ли удалить: видны все счета операции; корректировку — всегда (docs/api.md). */
export function canDelete(transaction: Transaction): boolean {
  return transaction.editable || transaction.kind === 'adjustment'
}
