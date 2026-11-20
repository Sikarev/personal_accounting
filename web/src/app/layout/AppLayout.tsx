import { AppShell } from '@mantine/core'
import { Outlet } from 'react-router'

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
 */
export function AppLayout() {
  const mobile = useMobileLayout()

  return (
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
  )
}
