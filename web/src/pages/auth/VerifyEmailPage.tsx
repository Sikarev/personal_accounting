import { Button } from '@mantine/core'
import { IconCircleCheck, IconCloudOff, IconLinkOff, IconMailCheck } from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'

import { paths } from '../../app/navigation'
import {
  apiErrorText,
  fieldErrorTexts,
  getGetMeQueryKey,
  useGetMe,
  useVerifyEmail,
} from '../../shared/api'
import { useT } from '../../shared/i18n'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import { AuthLayout, EmptyState } from '../../shared/ui'

/**
 * Подтверждение e-mail по ссылке из письма (`/verify-email?token=…`). Подтверждает сразу
 * при открытии; входа не требует — ссылку могут открыть в другом браузере или на телефоне.
 */
export function VerifyEmailPage() {
  const t = useT()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const queryClient = useQueryClient()
  // Вошёл ли пользователь — от этого зависит, куда ведёт кнопка. На публичной странице
  // 401 от /me не уводит на экран входа (см. handleUnauthorized).
  const me = useGetMe()
  const signedIn = !!me.data

  const verify = useVerifyEmail({
    mutation: {
      // Если пользователь вошёл, плашка «Подтвердите e-mail» должна исчезнуть.
      // /me запрашивается одновременно с подтверждением и может ответить раньше него —
      // ещё с emailVerified: false. invalidate не перезапрашивает запрос, который ещё
      // в пути без данных (дожидается его), поэтому сначала отменяем такой запрос.
      onSuccess: async () => {
        const queryKey = getGetMeQueryKey()
        await queryClient.cancelQueries({ queryKey })
        // Без await: экран успеха не ждёт нового ответа /me.
        void queryClient.invalidateQueries({ queryKey })
      },
    },
  })

  // Подтверждаем ровно один раз на токен. В StrictMode React в разработке запускает эффект
  // дважды (монтирует, размонтирует и снова монтирует компонент), но ref при этом
  // сохраняется — второй запуск видит, что запрос уже отправлен. Повторный запрос был бы
  // не только лишним: токен одноразовый, второй ответ пришёл бы с ошибкой.
  const startedFor = useRef<string | null>(null)
  const { mutate } = verify
  useEffect(() => {
    if (!token || startedFor.current === token) return
    startedFor.current = token
    mutate({ data: { token } })
  }, [token, mutate])

  const checking = !!token && (verify.isIdle || verify.isPending)
  const showChecking = useDelayedLoading(checking)

  const homeOrLogin = (
    <Button component={Link} to={signedIn ? paths.home : paths.login} variant="light" size="md">
      {signedIn ? t.auth.verify.toHome : t.auth.verify.toLogin}
    </Button>
  )

  if (checking) {
    // Быстрый ответ — без промежуточного экрана, долгий — «Проверяем ссылку…».
    if (!showChecking) return null
    return (
      <AuthLayout>
        <div role="status">
          <EmptyState icon={IconMailCheck} titleOrder={1} title={t.auth.verify.checkingTitle} />
        </div>
      </AuthLayout>
    )
  }

  if (verify.isSuccess) {
    return (
      <AuthLayout>
        <EmptyState
          icon={IconCircleCheck}
          titleOrder={1}
          title={t.auth.verify.successTitle}
          description={t.auth.verify.successDescription}
          action={homeOrLogin}
        />
      </AuthLayout>
    )
  }

  const tokenInvalid = !token || 'token' in fieldErrorTexts(verify.error, t)
  if (tokenInvalid) {
    return (
      <AuthLayout>
        <EmptyState
          icon={IconLinkOff}
          titleOrder={1}
          title={t.auth.verify.invalidTitle}
          description={signedIn ? t.auth.verify.invalidSignedIn : t.auth.verify.invalidGuest}
          action={homeOrLogin}
        />
      </AuthLayout>
    )
  }

  // Сеть, лимит, сервер: ссылка, возможно, в порядке — даём повторить.
  return (
    <AuthLayout>
      <EmptyState
        icon={IconCloudOff}
        titleOrder={1}
        title={t.auth.verify.errorTitle}
        description={apiErrorText(verify.error, t)}
        action={
          <Button variant="light" size="md" onClick={() => mutate({ data: { token } })}>
            {t.errors.retry}
          </Button>
        }
      />
    </AuthLayout>
  )
}
