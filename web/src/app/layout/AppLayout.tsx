import { AppShell } from '@mantine/core'
import { Outlet } from 'react-router'

import { QuickAddProvider } from '../../features/quick-add/QuickAddProvider'
import { EmailVerificationBanner } from '../../features/auth/EmailVerificationBanner'
import { useMobileLayout } from '../../shared/lib/useMobileLayout'
import { layout } from '../../theme'
import classes from './AppLayout.module.css'
import { BottomNav } from './BottomNav'
import { Sidebar } from './Sidebar'

/**
 * Оболочка приложения (requirements, раздел 6):
 * мобильная раскладка — нижняя панель, desktop — боковое меню.
 *
 * Раскладку выбирает `useMobileLayout()`, а не брейкпоинты AppShell: телефон в альбомной
 * ориентации шире 768 px, но должен оставаться в мобильной раскладке. Значение известно
 * при первом рендере, поэтому мигания desktop-версии нет.
 *
 * Окно быстрого ввода живёт внутри оболочки, а не в общих провайдерах: оболочка есть только
 * у вошедшего пользователя, и при выходе или истёкшей сессии (переход на /login) окно
 * размонтируется вместе с ней, а не остаётся поверх экрана входа.
 */
export function AppLayout() {
  const mobile = useMobileLayout()

  return (
    <QuickAddProvider>
      <AppShell
        navbar={mobile ? undefined : { width: layout.navbarWidth, breakpoint: 'sm' }}
        footer={
          mobile
            ? // Высота панели + отступ под системную полоску «домой» на iPhone.
              { height: 'calc(var(--app-bottom-nav-height) + env(safe-area-inset-bottom))' }
            : undefined
        }
      >
        {!mobile && <Sidebar />}

        <AppShell.Main className={classes.main} data-mobile={mobile || undefined}>
          <div className={classes.content}>
            <EmailVerificationBanner />
            <Outlet />
          </div>
        </AppShell.Main>

        {mobile && (
          <AppShell.Footer className={classes.footer}>
            <BottomNav />
          </AppShell.Footer>
        )}
      </AppShell>
    </QuickAddProvider>
  )
}
