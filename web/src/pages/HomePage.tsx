import { IconHome2 } from '@tabler/icons-react'

import { useT } from '../shared/i18n'
import { StubPage } from './StubPage'

export function HomePage() {
  const t = useT()
  return (
    <StubPage
      title={t.nav.home}
      icon={IconHome2}
      emptyTitle={t.pages.home.emptyTitle}
      emptyDescription={t.pages.home.emptyDescription}
      withAddAction
    />
  )
}
