import { IconSettings } from '@tabler/icons-react'

import { useT } from '../shared/i18n'
import { StubPage } from './StubPage'

export function SettingsPage() {
  const t = useT()
  return (
    <StubPage
      title={t.nav.settings}
      icon={IconSettings}
      emptyTitle={t.pages.settings.emptyTitle}
      emptyDescription={t.pages.settings.emptyDescription}
    />
  )
}
