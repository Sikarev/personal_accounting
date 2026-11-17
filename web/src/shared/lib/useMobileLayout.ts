import { DEFAULT_THEME } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'

import { theme } from '../../theme'

const sm = theme.breakpoints?.sm ?? DEFAULT_THEME.breakpoints.sm

/**
 * Когда приложению нужна мобильная раскладка (нижняя панель, bottom sheet):
 * - экран уже брейкпоинта `sm` (< 768 px);
 * - или телефон в альбомной ориентации: он широкий, но низкий и с сенсорным вводом —
 *   боковое меню и модалка по центру там неудобны.
 *
 * Единственный источник правды для оболочки, тостов и `ResponsiveSheet`.
 * Используется и вне React (`window.matchMedia`), например в `notifyWithUndo`.
 */
export const MOBILE_LAYOUT_QUERY = `(max-width: ${parseFloat(sm) - 0.01}em), (max-height: 30em) and (pointer: coarse)`

/** Мобильная раскладка сейчас — для кода вне React. */
export function matchesMobileLayout(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_LAYOUT_QUERY).matches
}

/**
 * `true`, если нужна мобильная раскладка (см. `MOBILE_LAYOUT_QUERY`).
 * Оболочка переключается этим хуком, а не CSS-брейкпоинтами: условие включает высоту
 * и тип указателя, которых нет в брейкпоинтах Mantine.
 */
export function useMobileLayout(): boolean {
  // getInitialValueInEffect: false — значение известно уже при первом рендере,
  // иначе на телефоне на мгновение отрисовалась бы desktop-версия (у нас SPA без SSR).
  return useMediaQuery(MOBILE_LAYOUT_QUERY, undefined, { getInitialValueInEffect: false })
}
