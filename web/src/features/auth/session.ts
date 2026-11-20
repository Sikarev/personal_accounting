import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useNavigate } from 'react-router'

import { getGetMeQueryKey, useGetMe, type Me } from '../../shared/api'
import { todayIn } from '../../shared/lib/date'
import { resetVerifyBannerDismissal } from './verifyBannerDismissal'

/**
 * Часовой пояс браузера — запасной вариант, пока профиль не загружен.
 * `Intl` может вернуть пустую строку в урезанных окружениях — тогда UTC.
 */
export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Часовой пояс пользователя: из профиля, а не из часов браузера (handoff → «Web»). */
export function timezoneOf(me: Me | undefined): string {
  return me?.user.timezone || browserTimezone()
}

/**
 * Часовой пояс пользователя из `/me`. Внутри приложения `/me` уже в кэше
 * (без него `RequireAuth` не пускает дальше), так что запроса хук не делает.
 */
export function useTimezone(): string {
  const me = useGetMe()
  return timezoneOf(me.data)
}

/**
 * «Сегодня» (`YYYY-MM-DD`) в часовом поясе пользователя — для `formatOpDate` и значения
 * даты по умолчанию. Пересчитывается при каждом рендере; в полночь экран обновится
 * со следующим рендером, отдельного таймера нет.
 */
export function useToday(): string {
  return todayIn(useTimezone())
}

/**
 * Завершить вход: вход, регистрация и сброс пароля возвращают `Me` и ставят cookie.
 * Кэш прежней сессии сбрасывается (там могли остаться данные другого пользователя
 * или ошибка 401), `/me` кладётся в кэш сразу — главная откроется без лишнего запроса.
 */
export function useCompleteSignIn() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useCallback(
    (me: Me, to: string) => {
      resetVerifyBannerDismissal()
      // removeQueries, а не clear: clear стёр бы и кэш изменений, а мы внутри onSuccess
      // мутации входа.
      queryClient.removeQueries()
      queryClient.setQueryData(getGetMeQueryKey(), me)
      navigate(to, { replace: true })
    },
    [queryClient, navigate],
  )
}
