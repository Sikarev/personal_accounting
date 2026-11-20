import type { QueryClient } from '@tanstack/react-query'
import type { NavigateFunction } from 'react-router'

import { isPublicPath, loginPath } from '../../app/navigation'

/**
 * Реакция на 401 от любого запроса (подключается в `createQueryClient({ onUnauthorized })`):
 * сессия кончилась — сбрасываем кэш и ведём на экран входа, запомнив, где был пользователь.
 *
 * На публичных страницах ничего не делаем: экран входа сам спрашивает `/me` и получает 401,
 * перенаправление оттуда на него же было бы петлёй. Адрес берём из `window.location`,
 * а не из состояния роутера: так видно и переход, сделанный только что в этом же такте.
 *
 * Сначала переход, потом очистка кэша: защищённый экран к этому моменту уже уходит
 * со страницы и не перезапрашивает свои данные.
 */
export function handleUnauthorized(queryClient: QueryClient, navigate: NavigateFunction): void {
  const { pathname, search, hash } = window.location
  if (isPublicPath(pathname)) return
  navigate(loginPath(pathname + search + hash), { replace: true })
  queryClient.clear()
}
