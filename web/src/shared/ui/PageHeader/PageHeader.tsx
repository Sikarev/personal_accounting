import { ActionIcon, Group, Title } from '@mantine/core'
import { IconArrowLeft } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import { icons } from '../../../theme'
import classes from './PageHeader.module.css'

export type PageHeaderProps = {
  /** Заголовок экрана — единственный h1 на странице. */
  title: string
  /** Действия справа от заголовка (кнопки, переключатели). */
  actions?: ReactNode
  /**
   * Кнопка «Назад» слева от заголовка — к родительскому экрану (на mobile, где нет бокового
   * меню). `label` — доступное имя: «Назад к настройкам».
   */
  back?: { to: string; label: string }
}

/** Заголовок экрана с одинаковыми отступами на всех страницах. */
export function PageHeader({ title, actions, back }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="center" gap="md" mb="lg" wrap="nowrap">
      <Group
        gap="xs"
        align="center"
        wrap="nowrap"
        className={classes.start}
        data-shrink={actions ? undefined : true}
      >
        {back && (
          <ActionIcon
            component={Link}
            to={back.to}
            variant="subtle"
            color="gray"
            radius="xl"
            aria-label={back.label}
            className={classes.back}
          >
            <IconArrowLeft size={icons.size.lg} stroke={icons.stroke} />
          </ActionIcon>
        )}
        <Title order={1} size="xl" className={classes.title}>
          {title}
        </Title>
      </Group>
      {actions}
    </Group>
  )
}
