import { IconChartPie } from '@tabler/icons-react'

import { useT } from '../shared/i18n'
import { StubPage } from './StubPage'

export function ReportsPage() {
  const t = useT()
  return (
    <StubPage
      title={t.nav.reports}
      icon={IconChartPie}
      emptyTitle={t.pages.reports.emptyTitle}
      emptyDescription={t.pages.reports.emptyDescription}
    />
  )
}
