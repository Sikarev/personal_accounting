import { IconListDetails } from '@tabler/icons-react'

import { useT } from '../shared/i18n'
import { StubPage } from './StubPage'

export function TransactionsPage() {
  const t = useT()
  return (
    <StubPage
      title={t.nav.transactions}
      icon={IconListDetails}
      emptyTitle={t.pages.transactions.emptyTitle}
      emptyDescription={t.pages.transactions.emptyDescription}
      withAddAction
    />
  )
}
