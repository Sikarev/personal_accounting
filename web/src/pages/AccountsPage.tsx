import { IconWallet } from '@tabler/icons-react'

import { useT } from '../shared/i18n'
import { StubPage } from './StubPage'

export function AccountsPage() {
  const t = useT()
  return (
    <StubPage
      title={t.nav.accounts}
      icon={IconWallet}
      emptyTitle={t.pages.accounts.emptyTitle}
      emptyDescription={t.pages.accounts.emptyDescription}
    />
  )
}
