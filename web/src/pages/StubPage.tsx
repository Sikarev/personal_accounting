import { Button, Paper } from '@mantine/core'
import { IconPlus, type Icon } from '@tabler/icons-react'

import { useQuickAdd } from '../features/quick-add/quickAddContext'
import { useT } from '../shared/i18n'
import { EmptyState, PageHeader } from '../shared/ui'
import { icons } from '../theme'

type StubPageProps = {
  title: string
  icon: Icon
  emptyTitle: string
  emptyDescription: string
  /** Показать главное действие «Добавить операцию». */
  withAddAction?: boolean
}

/**
 * Временный экран раздела: заголовок и пустое состояние, объясняющее, что здесь будет.
 * Заменяется настоящим экраном на соответствующем этапе roadmap.
 */
export function StubPage({
  title,
  icon,
  emptyTitle,
  emptyDescription,
  withAddAction,
}: StubPageProps) {
  const t = useT()
  const quickAdd = useQuickAdd()

  return (
    <>
      <PageHeader title={title} />
      <Paper withBorder radius="lg">
        <EmptyState
          icon={icon}
          title={emptyTitle}
          description={emptyDescription}
          action={
            withAddAction && (
              <Button
                variant="light"
                leftSection={<IconPlus size={icons.size.md} stroke={2} />}
                onClick={quickAdd.open}
              >
                {t.nav.addTransaction}
              </Button>
            )
          }
        />
      </Paper>
    </>
  )
}
