import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'

import { paths } from '../../app/navigation'
import { apiErrorText, useLogout } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { resetVerifyBannerDismissal } from './verifyBannerDismissal'

/**
 * Выход: сервер удаляет сессию и стирает cookie, приложение сбрасывает весь кэш
 * и ведёт на экран входа.
 *
 * Если сервер не ответил, «выйти локально» нельзя: cookie `httpOnly`, JavaScript её
 * не сотрёт, и следующий запрос снова был бы от имени пользователя. Поэтому при ошибке
 * остаёмся на месте и показываем, что случилось.
 */
export function useLogoutAction() {
  const t = useT()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const mutation = useLogout({
    mutation: {
      onSuccess: () => {
        resetVerifyBannerDismissal()
        // Сначала уходим с защищённого экрана, потом чистим кэш — иначе он успел бы
        // перезапросить свои данные и получить 401.
        navigate(paths.login, { replace: true })
        queryClient.clear()
      },
      onError: (error) => {
        notifications.show({ color: 'red', message: apiErrorText(error, t) })
      },
    },
  })

  return { logout: () => mutation.mutate(), isPending: mutation.isPending }
}
