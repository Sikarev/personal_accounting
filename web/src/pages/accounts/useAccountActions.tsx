import { Button, Stack, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'

import {
  apiErrorText,
  ApiError,
  useArchiveAccount,
  useCreateAccount,
  useDeleteAccount,
  useReorderAccounts,
  useUnarchiveAccount,
  type Account,
} from '../../shared/api'
import { useT } from '../../shared/i18n'
import { groupActiveAccounts } from '../../shared/lib/accounts'
import { notifyWithUndo } from '../../shared/ui'
import {
  accountMutationOptions,
  cancelAccountsFetch,
  patchAccounts,
  readAccounts,
  upsertAccount,
} from '../../features/accounts/accountsCache'

/**
 * Действия со счетами, которые выполняются сразу, без подтверждения (ux.md, принцип 4):
 * архив, возврат из архива, удаление и порядок. Все — оптимистичные: экран меняется
 * до ответа сервера, при ошибке правка откатывается и показывается тост с причиной.
 * Архив, возврат и удаление можно отменить из тоста (и Ctrl+Z на desktop).
 */
export function useAccountActions() {
  const t = useT()
  const qc = useQueryClient()
  const mutation = accountMutationOptions(qc)
  const archiveMutation = useArchiveAccount(mutation)
  const unarchiveMutation = useUnarchiveAccount(mutation)
  const deleteMutation = useDeleteAccount(mutation)
  const createMutation = useCreateAccount(mutation)
  const reorderMutation = useReorderAccounts(mutation)

  const notifyError = (error: unknown, title?: string) =>
    notifications.show({ color: 'red', title, message: apiErrorText(error, t) })

  const setArchivedAt = (id: string, archivedAt: string | null) =>
    patchAccounts(qc, (items) => items.map((a) => (a.id === id ? { ...a, archivedAt } : a)))

  /**
   * Архив или возврат из архива. Возвращает промис «удалось ли»: отмена из тоста
   * дожидается исходного запроса, чтобы не обогнать его.
   */
  const setArchived = (account: Account, archived: boolean, withUndo: boolean) => {
    cancelAccountsFetch(qc)
    // Откатываемся к тому, что сейчас на экране, а не к снимку из аргумента.
    const before =
      readAccounts(qc).find((a) => a.id === account.id)?.archivedAt ?? account.archivedAt
    // Вызывается из обработчиков событий, не при рендере; точное время придёт с сервера.
    // oxlint-disable-next-line react/purity
    setArchivedAt(account.id, archived ? new Date().toISOString() : null)

    let toastId: string | undefined
    const run = archived ? archiveMutation : unarchiveMutation
    const done = run.mutateAsync({ accountId: account.id }).then(
      (updated) => {
        upsertAccount(qc, updated)
        return true
      },
      (error: unknown) => {
        setArchivedAt(account.id, before)
        if (toastId) notifications.hide(toastId)
        notifyError(error)
        return false
      },
    )

    if (withUndo) {
      toastId = notifyWithUndo({
        message: archived
          ? t.accounts.toasts.archived(account.name)
          : t.accounts.toasts.unarchived(account.name),
        onUndo: () => {
          void done.then((ok) => {
            if (ok) void setArchived(account, !archived, false)
          })
        },
      })
    }
    return done
  }

  const archive = (account: Account) => setArchived(account, true, true)
  const unarchive = (account: Account) => setArchived(account, false, true)

  /** Новый порядок группы (id всех её активных счетов). */
  const reorder = (ids: string[]) => {
    cancelAccountsFetch(qc)
    const before = new Map(readAccounts(qc).map((a) => [a.id, a.sortOrder]))
    const position = new Map(ids.map((id, index) => [id, index]))
    patchAccounts(qc, (items) =>
      items.map((a) => (position.has(a.id) ? { ...a, sortOrder: position.get(a.id)! } : a)),
    )
    return reorderMutation.mutateAsync({ data: { accountIds: ids } }).then(
      () => true,
      (error: unknown) => {
        patchAccounts(qc, (items) =>
          items.map((a) => (before.has(a.id) ? { ...a, sortOrder: before.get(a.id)! } : a)),
        )
        notifyError(error, t.errors.reorderFailed)
        return false
      },
    )
  }

  /**
   * Отмена удаления: счёт создаётся заново с теми же полями (id будет новый) и встаёт
   * на прежнее место в своей группе; архивный снова уходит в архив.
   */
  const restore = async (account: Account, index: number) => {
    let created: Account
    try {
      created = await createMutation.mutateAsync({
        data: {
          name: account.name,
          type: account.type,
          currency: account.currency,
          initialBalance: account.initialBalance,
          visibility: account.visibility,
          includeInTotal: account.includeInTotal,
          color: account.color,
        },
      })
    } catch (error) {
      notifyRestoreFailed(account, index, error)
      return
    }
    upsertAccount(qc, created)

    if (account.archivedAt !== null) {
      await setArchived(created, true, false)
      return
    }
    const ids = groupActiveAccounts(readAccounts(qc))
      [account.visibility].map((a) => a.id)
      .filter((id) => id !== created.id)
    ids.splice(Math.min(Math.max(index, 0), ids.length), 0, created.id)
    await reorder(ids)
  }

  /**
   * Счёт не удалось создать заново (нет связи и т. п.). Тост не закрывается сам:
   * иначе удалённый счёт потерялся бы безвозвратно. «Повторить» пробует ещё раз.
   */
  const notifyRestoreFailed = (account: Account, index: number, error: unknown) => {
    const id = `restore-failed-${account.id}`
    notifications.show({
      id,
      color: 'red',
      autoClose: false,
      title: t.accounts.toasts.restoreFailed(account.name),
      message: (
        <Stack gap="sm" align="flex-start">
          <Text size="sm" c="var(--mantine-color-text)">
            {apiErrorText(error, t)}
          </Text>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              notifications.hide(id)
              void restore(account, index)
            }}
          >
            {t.errors.retry}
          </Button>
        </Stack>
      ),
    })
  }

  /** Тост «есть операции» с предложением архивировать — вместо удаления. */
  const notifyHasTransactions = (account: Account) => {
    const id = `has-transactions-${account.id}`
    notifications.show({
      id,
      color: 'red',
      autoClose: false,
      message: (
        <Stack gap="sm" align="flex-start">
          <Text size="sm" c="var(--mantine-color-text)">
            {t.accounts.toasts.hasTransactions}
          </Text>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              notifications.hide(id)
              void archive({ ...account, archivedAt: null })
            }}
          >
            {t.accounts.actions.archive}
          </Button>
        </Stack>
      ),
    })
  }

  /** Удаление счёта без операций: сразу, с отменой из тоста. */
  const remove = (account: Account) => {
    cancelAccountsFetch(qc)
    const index = groupActiveAccounts(readAccounts(qc))[account.visibility].findIndex(
      (a) => a.id === account.id,
    )
    patchAccounts(qc, (items) => items.filter((a) => a.id !== account.id))

    let toastId: string | undefined
    const done = deleteMutation.mutateAsync({ accountId: account.id }).then(
      () => true,
      (error: unknown) => {
        upsertAccount(qc, account)
        if (toastId) notifications.hide(toastId)
        // Кто-то успел внести операцию на счёт — удалить нельзя, но можно архивировать.
        if (error instanceof ApiError && error.code === 'account_has_transactions') {
          notifyHasTransactions(account)
        } else {
          notifyError(error)
        }
        return false
      },
    )

    toastId = notifyWithUndo({
      message: t.accounts.toasts.deleted(account.name),
      onUndo: () => {
        void done.then((ok) => (ok ? restore(account, index) : undefined))
      },
    })
    return done
  }

  return { archive, unarchive, remove, reorder }
}
