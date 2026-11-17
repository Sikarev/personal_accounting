import { useMantineTheme } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'

/**
 * `true` на экранах уже брейкпоинта `sm` (< 768 px): нижняя панель, bottom sheet.
 * Для вёрстки предпочтительнее CSS (`hiddenFrom`, `visibleFrom`, media в CSS-модулях);
 * хук — для случаев, когда меняется сам компонент (Drawer вместо Modal).
 */
export function useIsMobile(): boolean {
  const theme = useMantineTheme()
  // getInitialValueInEffect: false — значение известно сразу при первом рендере,
  // иначе на телефоне на мгновение отрисовалась бы desktop-версия (у нас SPA без SSR).
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`, undefined, {
    getInitialValueInEffect: false,
  })
  return !isDesktop
}
