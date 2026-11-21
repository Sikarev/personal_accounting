import { Button, Radio, Stack, Text } from '@mantine/core'
import { useState, type FormEvent } from 'react'

import type { Category } from '../../../shared/api'
import { useT } from '../../../shared/i18n'
import type { CategoryNode } from '../../../shared/lib/categoryTree'
import classes from './MoveCategoryForm.module.css'

const TOP_LEVEL = 'top'

/**
 * «Переместить в…» — доступная альтернатива перетаскиванию: выбор родителя радиокнопками
 * («Верхний уровень» или категория верхнего уровня того же вида). Категория встаёт в конец
 * нового родителя; порядок внутри — перетаскиванием.
 *
 * Недопустимые цели неактивны с пояснением: текущее место («Сейчас здесь»), сама категория
 * не показывается; категорию с подкатегориями вложить нельзя — у неё активен только
 * верхний уровень.
 */
export function MoveCategoryForm({
  category,
  nodes,
  hasChildren,
  onSubmit,
}: {
  category: Category
  /** Активное дерево того же вида. */
  nodes: readonly CategoryNode[]
  hasChildren: boolean
  onSubmit: (parentId: string | null) => void
}) {
  const t = useT()
  const current = category.parentId ?? TOP_LEVEL
  const parents = nodes.filter((n) => n.id !== category.id)
  const [value, setValue] = useState<string | null>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (value === null) return
    onSubmit(value === TOP_LEVEL ? null : value)
  }

  const option = (id: string, label: string, disabled: boolean) => (
    <Radio
      key={id}
      value={id}
      label={label}
      description={id === current ? t.categories.move.current : undefined}
      disabled={disabled}
      size="md"
      classNames={{ root: classes.option, body: classes.body, label: classes.label }}
    />
  )

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stack gap="md">
        <Radio.Group label={t.categories.move.label} value={value} onChange={setValue} size="md">
          <Stack gap={0} mt="xs">
            {option(TOP_LEVEL, t.categories.move.topLevel, current === TOP_LEVEL)}
            {parents.map((p) => option(p.id, p.name, hasChildren || p.id === current))}
          </Stack>
        </Radio.Group>
        {hasChildren && (
          <Text size="sm" c="dimmed">
            {t.categories.move.hasChildren}
          </Text>
        )}
        <Button type="submit" size="md" fullWidth disabled={value === null}>
          {t.categories.move.submit}
        </Button>
      </Stack>
    </form>
  )
}
