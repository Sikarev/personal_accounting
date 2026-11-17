import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import { QuickAddProvider } from '../features/quick-add/QuickAddProvider'
import { useIsMobile } from '../shared/lib/useIsMobile'
import { cssVariablesResolver, theme } from '../theme'
import classes from './AppProviders.module.css'

/** Тема и тосты: всё, что нужно компонентам Mantine. Используется и в Storybook. */
export function ThemeProviders({
  children,
  forceColorScheme,
}: {
  children: ReactNode
  /** Принудительная тема (Storybook). В приложении — по настройке системы. */
  forceColorScheme?: 'light' | 'dark'
}) {
  return (
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      defaultColorScheme="auto"
      forceColorScheme={forceColorScheme}
    >
      <AppNotifications />
      {children}
    </MantineProvider>
  )
}

function AppNotifications() {
  const isMobile = useIsMobile()
  // На mobile тосты снизу по центру, над нижней панелью — рядом с большим пальцем
  // и кнопкой «Отменить»; на desktop — в правом нижнем углу, не перекрывая контент.
  return (
    <Notifications
      position={isMobile ? 'bottom-center' : 'bottom-right'}
      classNames={{ root: classes.notifications }}
    />
  )
}

/** Все провайдеры приложения. Роутер — снаружи (main.tsx), чтобы тесты могли подставить свой. */
export function AppProviders({ children }: { children: ReactNode }) {
  // Клиент создаётся один раз на жизнь приложения (useState, а не модульная переменная —
  // так он не переживает hot reload с устаревшим кэшем).
  const [queryClient] = useState(() => new QueryClient())

  return (
    <ThemeProviders>
      <QueryClientProvider client={queryClient}>
        <QuickAddProvider>{children}</QuickAddProvider>
      </QueryClientProvider>
    </ThemeProviders>
  )
}
