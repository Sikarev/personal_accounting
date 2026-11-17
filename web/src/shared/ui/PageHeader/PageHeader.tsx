import { Group, Title } from '@mantine/core'
import type { ReactNode } from 'react'

export type PageHeaderProps = {
  /** Заголовок экрана — единственный h1 на странице. */
  title: string
  /** Действия справа от заголовка (кнопки, переключатели). */
  actions?: ReactNode
}

/** Заголовок экрана с одинаковыми отступами на всех страницах. */
export function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="center" gap="md" mb="lg" wrap="nowrap">
      <Title order={1} size="xl">
        {title}
      </Title>
      {actions}
    </Group>
  )
}
