import { AppShell } from '@mantine/core'
import { Outlet } from 'react-router'

import { layout } from '../../theme'
import classes from './AppLayout.module.css'
import { BottomNav } from './BottomNav'
import { Sidebar } from './Sidebar'

/**
 * Оболочка приложения (requirements, раздел 6):
 * desktop (≥ sm) — боковое меню, mobile (< sm) — нижняя панель.
 * Переключение — чистым CSS через конфигурацию AppShell, без мигания при загрузке.
 */
export function AppLayout() {
  return (
    <AppShell
      navbar={{
        width: layout.navbarWidth,
        breakpoint: 'sm',
        // На mobile боковое меню не выезжает вовсе: его роль играет нижняя панель и экран «Ещё».
        collapsed: { mobile: true },
      }}
      footer={{
        // Высота панели + отступ под системную полоску «домой» на iPhone.
        // На desktop панели нет — и отступа под неё тоже.
        height: {
          base: `calc(var(--app-bottom-nav-height) + env(safe-area-inset-bottom))`,
          sm: 0,
        },
      }}
    >
      <Sidebar />

      <AppShell.Main className={classes.main}>
        <div className={classes.content}>
          <Outlet />
        </div>
      </AppShell.Main>

      <AppShell.Footer hiddenFrom="sm" className={classes.footer}>
        <BottomNav />
      </AppShell.Footer>
    </AppShell>
  )
}
