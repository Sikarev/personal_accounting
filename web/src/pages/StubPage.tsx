import { Paper } from '@mantine/core'
import type { Icon } from '@tabler/icons-react'

import { EmptyState, PageHeader } from '../shared/ui'

type StubPageProps = {
  title: string
  icon: Icon
  emptyTitle: string
  emptyDescription: string
}

/**
 * Временный экран раздела: заголовок и пустое состояние, объясняющее, что здесь будет.
 * Заменяется настоящим экраном на соответствующем этапе roadmap.
 */
export function StubPage({ title, icon, emptyTitle, emptyDescription }: StubPageProps) {
  return (
    <>
      <PageHeader title={title} />
      <Paper withBorder radius="lg">
        <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} />
      </Paper>
    </>
  )
}
