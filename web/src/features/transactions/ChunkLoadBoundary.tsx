import { Button } from '@mantine/core'
import { IconRefresh } from '@tabler/icons-react'
import { Component, type ReactNode } from 'react'

import { useT } from '../../shared/i18n'
import { EmptyState } from '../../shared/ui'

/**
 * Ленивый чанк формы операции не загрузился (нет сети, вышла новая версия) — объяснение
 * и «Обновить страницу» вместо пустого места. Для окна быстрого ввода, окна правки
 * и формы на главной; экраны целиком ловит `RouteBoundary`.
 */
export class ChunkLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <LoadError /> : this.props.children
  }
}

function LoadError() {
  const t = useT()
  return (
    <EmptyState
      icon={IconRefresh}
      titleOrder={3}
      title={t.lazyRoute.errorTitle}
      description={t.lazyRoute.errorDescription}
      action={
        <Button variant="light" size="md" onClick={() => window.location.reload()}>
          {t.lazyRoute.reload}
        </Button>
      }
    />
  )
}
