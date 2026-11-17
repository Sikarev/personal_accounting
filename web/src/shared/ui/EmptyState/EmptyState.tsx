import { Stack, Text, ThemeIcon, Title } from '@mantine/core'
import type { Icon } from '@tabler/icons-react'
import type { ReactNode } from 'react'

import { icons } from '../../../theme'
import classes from './EmptyState.module.css'

export type EmptyStateProps = {
  /** Иконка Tabler, поясняющая, что здесь будет. */
  icon: Icon
  /** Что здесь появится — словами пользователя. */
  title: string
  /** Зачем это нужно или что сделать дальше. */
  description?: string
  /** Главное действие: обычно одна кнопка с глаголом («Добавить операцию»). */
  action?: ReactNode
  /**
   * Уровень заголовка в документе: по умолчанию h2 (под заголовком экрана),
   * h1 — когда пустое состояние и есть весь экран, h3 — внутри диалога.
   */
  titleOrder?: 1 | 2 | 3
}

/**
 * Пустое состояние экрана или блока (ux.md, раздел 4): объяснение и главное действие
 * вместо голого «Нет данных».
 */
export function EmptyState({
  icon: IconComponent,
  title,
  description,
  action,
  titleOrder = 2,
}: EmptyStateProps) {
  return (
    <Stack align="center" gap="md" className={classes.root}>
      <ThemeIcon size={icons.badgeSize} radius="xl" variant="light" aria-hidden>
        <IconComponent size={icons.size.xl} stroke={icons.stroke} />
      </ThemeIcon>
      <Stack gap="xs" align="center">
        <Title order={titleOrder} size="lg" ta="center">
          {title}
        </Title>
        {description && (
          <Text c="dimmed" size="sm" ta="center" className={classes.description}>
            {description}
          </Text>
        )}
      </Stack>
      {action}
    </Stack>
  )
}
