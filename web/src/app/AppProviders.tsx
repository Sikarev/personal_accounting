import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'

import { handleUnauthorized } from '../features/auth/unauthorized'
import { createQueryClient } from '../shared/api'
import { useMobileLayout } from '../shared/lib/useMobileLayout'
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
  const mobile = useMobileLayout()
  // В мобильной раскладке тосты сверху по центру: снизу их закрывала бы клавиатура —
  // после сохранения в быстром вводе фокус возвращается в сумму, и клавиатура остаётся
  // поднятой. На desktop — в правом нижнем углу, не перекрывая контент.
  return (
    <Notifications
      position={mobile ? 'top-center' : 'bottom-right'}
      classNames={{ root: mobile ? classes.belowSafeArea : undefined }}
    />
  )
}

/**
 * Все провайдеры приложения. Роутер — снаружи (main.tsx), чтобы тесты могли подставить свой;
 * он обязателен: при 401 отсюда выполняется переход на экран входа.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  // navigate — через ref: клиент создаётся один раз, а функция из хука может смениться.
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

  // Клиент создаётся один раз на жизнь приложения (useState, а не модульная переменная —
  // так он не переживает hot reload с устаревшим кэшем).
  // Ref читается не при рендере, а позже, когда придёт ошибка, — линтер этого не различает.
  // oxlint-disable-next-line react/refs
  const [queryClient] = useState(() => {
    const client = createQueryClient({
      // 401 на любом запросе — сессия кончилась: на экран входа (features/auth/unauthorized.ts).
      onUnauthorized: () => handleUnauthorized(client, navigateRef.current),
    })
    return client
  })

  return (
    <ThemeProviders>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProviders>
  )
}
