import { Button, Paper } from '@mantine/core'
import { IconMapOff } from '@tabler/icons-react'
import { Link } from 'react-router'

import { paths } from '../app/navigation'
import { useT } from '../shared/i18n'
import { EmptyState } from '../shared/ui'

export function NotFoundPage() {
  const t = useT()
  return (
    <Paper withBorder radius="lg">
      <EmptyState
        icon={IconMapOff}
        titleOrder={1}
        title={t.pages.notFound.title}
        description={t.pages.notFound.description}
        action={
          <Button component={Link} to={paths.home} variant="light">
            {t.pages.notFound.action}
          </Button>
        }
      />
    </Paper>
  )
}
