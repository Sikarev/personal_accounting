import { Group, Paper, Stack, Text, ThemeIcon } from '@mantine/core'
import { IconHomeDollar } from '@tabler/icons-react'
import type { ReactNode } from 'react'

import { useT } from '../../i18n'
import { useMobileLayout } from '../../lib/useMobileLayout'
import { icons } from '../../../theme'
import classes from './AuthLayout.module.css'

export type AuthLayoutProps = {
  children: ReactNode
  /**
   * Ширина карточки на desktop: `form` — формы входа и восстановления пароля,
   * `reading` — текстовые страницы (документы). На mobile — всегда во всю ширину.
   */
  width?: 'form' | 'reading'
}

/**
 * Каркас экранов без оболочки приложения (вход, регистрация, восстановление пароля,
 * документы): логотип и карточка по центру экрана. В мобильной раскладке карточки нет —
 * содержимое занимает всю ширину и начинается сверху, под большим пальцем ниже клавиатуры.
 */
export function AuthLayout({ children, width = 'form' }: AuthLayoutProps) {
  const t = useT()
  const mobile = useMobileLayout()

  return (
    <main className={classes.root} data-mobile={mobile || undefined}>
      <Stack gap="lg" className={classes.column} data-width={width}>
        <Group gap="sm" wrap="nowrap" className={classes.brand}>
          <ThemeIcon size="lg" radius="md" aria-hidden>
            <IconHomeDollar size={icons.size.md} stroke={icons.stroke} />
          </ThemeIcon>
          <div>
            <Text fw={600} size="sm" lh="xs">
              {t.app.name}
            </Text>
            <Text c="dimmed" size="xs" lh="xs">
              {t.auth.tagline}
            </Text>
          </div>
        </Group>
        <Paper withBorder radius="lg" className={classes.card}>
          {children}
        </Paper>
      </Stack>
    </main>
  )
}
