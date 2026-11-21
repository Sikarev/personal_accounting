import type { QueryClient } from '@tanstack/react-query'

import { getListAccountsQueryKey, type Account, type AccountList } from '../../shared/api'

/**
 * Кэш списка счетов (`GET /accounts`): чтение, точечные правки для оптимистичных
 * обновлений и обновление с сервера после мутаций.
 */

const MUTATION_KEYS = new Set([
  'createAccount',
  'updateAccount',
  'archiveAccount',
  'unarchiveAccount',
  'deleteAccount',
  'reorderAccounts',
  'adjustAccountBalance',
])

export function readAccounts(qc: QueryClient): Account[] {
  return qc.getQueryData<AccountList>(getListAccountsQueryKey())?.items ?? []
}

export function patchAccounts(qc: QueryClient, update: (items: Account[]) => Account[]) {
  qc.setQueryData<AccountList>(getListAccountsQueryKey(), (old) =>
    old ? { ...old, items: update(old.items) } : old,
  )
}

/** Заменить счёт в кэше ответом сервера (или добавить, если его там нет). */
export function upsertAccount(qc: QueryClient, account: Account) {
  patchAccounts(qc, (items) =>
    items.some((a) => a.id === account.id)
      ? items.map((a) => (a.id === account.id ? account : a))
      : [...items, account],
  )
}

/** Остановить загрузку списка, чтобы старый ответ не затёр оптимистичную правку. */
export function cancelAccountsFetch(qc: QueryClient) {
  void qc.cancelQueries({ queryKey: getListAccountsQueryKey() })
}

/**
 * Перезапросить список после мутации — но только когда она последняя из идущих:
 * ответ, пришедший посреди серии быстрых действий (архив, тут же перетаскивание),
 * на мгновение вернул бы на экран старое состояние. Вызывается из `onSettled`,
 * где текущая мутация ещё считается идущей, — отсюда `<= 1`.
 */
export function refreshAccounts(qc: QueryClient) {
  const running = qc.isMutating({
    predicate: (m) => MUTATION_KEYS.has(String(m.options.mutationKey?.[0])),
  })
  if (running <= 1) void qc.invalidateQueries({ queryKey: getListAccountsQueryKey() })
}
