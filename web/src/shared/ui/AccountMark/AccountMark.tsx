import { ThemeIcon } from '@mantine/core'

import type { AccountColor, AccountType } from '../../api'
import { icons } from '../../../theme'
import { accountTypeIcons } from './accountTypeIcons'

export type AccountMarkProps = {
  type: AccountType
  /** Цвет счёта из палитры Mantine; `null` — нейтральная метка. */
  color: AccountColor | null
  size?: 'md' | 'lg'
}

/**
 * Метка счёта: кружок с иконкой типа. Если у счёта задан цвет — кружок этого цвета
 * (токен `--mantine-color-<цвет>-filled`), иначе спокойная серая подложка.
 * Иконка остаётся и на цветной метке: цвет не единственный носитель смысла.
 * Декоративна для экранного диктора — тип и название счёта есть текстом рядом.
 */
export function AccountMark({ type, color, size = 'lg' }: AccountMarkProps) {
  const TypeIcon = accountTypeIcons[type]
  return (
    <ThemeIcon
      aria-hidden
      radius="xl"
      size={size === 'lg' ? 'xl' : 'lg'}
      color={color ?? 'gray'}
      variant={color ? 'filled' : 'light'}
      // Белая иконка на жёлтом и салатовом не видна — autoContrast выберет тёмную.
      autoContrast
    >
      <TypeIcon size={icons.size.md} stroke={icons.stroke} />
    </ThemeIcon>
  )
}
