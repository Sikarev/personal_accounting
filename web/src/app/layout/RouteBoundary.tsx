import { Button, Paper, Skeleton, Stack, VisuallyHidden } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { Component, Suspense, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router'

import { useT } from '../../shared/i18n'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import { EmptyState } from '../../shared/ui'
import classes from './RouteBoundary.module.css'

/**
 * Обёртка экранов внутри оболочки (App.tsx) для ленивых маршрутов (`React.lazy`):
 * - пока чанк экрана грузится — скелетон страницы, но только если дольше 300 мс (ux.md, §4);
 * - чанк не загрузился (нет сети; после выкладки новой версии старого файла уже нет) —
 *   «Не удалось загрузить экран» с «Обновить страницу» вместо белого экрана; меню остаётся.
 *
 * Ключ — путь: переход на другой экран сбрасывает ошибку, и он грузится заново.
 */
export function RouteBoundary() {
  const { pathname } = useLocation()
  return (
    <LoadErrorBoundary key={pathname}>
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>
    </LoadErrorBoundary>
  )
}

/** Перехват ошибки рендера возможен только классовым компонентом (так устроен React). */
class LoadErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <LoadError /> : this.props.children
  }
}

function LoadError() {
  const t = useT()
  return (
    <Paper withBorder radius="lg" mt="lg">
      <EmptyState
        icon={IconRefresh}
        titleOrder={1}
        title={t.lazyRoute.errorTitle}
        description={t.lazyRoute.errorDescription}
        action={
          <Button variant="light" onClick={() => window.location.reload()}>
            {t.lazyRoute.reload}
          </Button>
        }
      />
    </Paper>
  )
}

/** Скелетон страницы: заголовок и несколько строк — общий для любого экрана. */
function PageLoading() {
  const t = useT()
  const show = useDelayedLoading(true)
  if (!show) return null
  return (
    <div role="status" aria-live="polite">
      <VisuallyHidden>{t.common.loading}</VisuallyHidden>
      <Stack gap="md" aria-hidden>
        <Skeleton className={classes.title} radius="sm" />
        <Skeleton className={classes.block} radius="lg" />
      </Stack>
    </div>
  )
}
