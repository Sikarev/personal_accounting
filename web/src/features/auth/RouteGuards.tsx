import { Button, Skeleton, Stack, VisuallyHidden } from '@mantine/core'
import { IconCloudOff } from '@tabler/icons-react'
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router'

import { loginPath } from '../../app/navigation'
import { apiErrorText, isUnauthorizedError, useGetMe } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { safeNextPath } from '../../shared/lib/safeNext'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import { AuthLayout, EmptyState } from '../../shared/ui'
import classes from './RouteGuards.module.css'

/**
 * Защищённая часть приложения: пускает дальше, только если `/me` ответил.
 *
 * - `/me` грузится — ничего (быстрый ответ) или скелетон, если дольше 300 мс;
 *   форму входа не показываем, чтобы она не мигнула у вошедшего пользователя.
 * - 401 — на экран входа с возвратом сюда же. Обычно раньше это делает глобальный
 *   обработчик (`handleUnauthorized`), здесь — запасной путь.
 * - Сеть или сервер — экран ошибки с повтором.
 */
export function RequireAuth() {
  const me = useGetMe()
  const location = useLocation()
  const showSkeleton = useDelayedLoading(me.isPending)

  if (me.data) return <Outlet />
  if (me.isPending) return showSkeleton ? <SessionSkeleton /> : null
  if (isUnauthorizedError(me.error)) {
    return <Navigate to={loginPath(location.pathname + location.search + location.hash)} replace />
  }
  return (
    <SessionError error={me.error} onRetry={() => void me.refetch()} retrying={me.isFetching} />
  )
}

/**
 * Экраны входа и регистрации: вошедшего пользователя сразу отправляют туда,
 * куда он шёл (`next`), или на главную.
 */
export function RedirectIfAuthenticated() {
  const me = useGetMe()
  const [params] = useSearchParams()
  const showSkeleton = useDelayedLoading(me.isPending)

  if (me.data) return <Navigate to={safeNextPath(params.get('next'))} replace />
  if (me.isPending) return showSkeleton ? <SessionSkeleton /> : null
  // 401 — обычный случай: не вошёл. Ошибка сети тоже показывает форму: при отправке
  // пользователь увидит понятное сообщение о связи.
  return <Outlet />
}

/** Пока неизвестно, вошёл ли пользователь: скелетон, а не спиннер (ux.md, раздел 4). */
function SessionSkeleton() {
  const t = useT()
  return (
    <main className={classes.skeleton} aria-busy="true">
      <div role="status">
        <VisuallyHidden>{t.common.loading}</VisuallyHidden>
      </div>
      <Stack gap="lg" className={classes.skeletonColumn} aria-hidden>
        <Skeleton className={classes.skeletonTitle} radius="sm" />
        <Skeleton className={classes.skeletonCard} radius="lg" />
        <Skeleton className={classes.skeletonCardSmall} radius="lg" />
      </Stack>
    </main>
  )
}

function SessionError({
  error,
  onRetry,
  retrying,
}: {
  error: unknown
  onRetry: () => void
  retrying: boolean
}) {
  const t = useT()
  return (
    <AuthLayout>
      <EmptyState
        icon={IconCloudOff}
        titleOrder={1}
        title={t.auth.session.errorTitle}
        description={apiErrorText(error, t)}
        action={
          <Button variant="light" size="md" onClick={onRetry} loading={retrying}>
            {t.errors.retry}
          </Button>
        }
      />
    </AuthLayout>
  )
}
