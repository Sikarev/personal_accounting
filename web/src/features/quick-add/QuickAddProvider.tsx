import { Button } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconRefresh } from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { Component, lazy, Suspense, useEffect, useMemo, type ReactNode } from 'react'

import {
  getGetTransactionDefaultsQueryOptions,
  getListCategoriesQueryOptions,
  getListCurrenciesQueryOptions,
} from '../../shared/api'
import { useT } from '../../shared/i18n'
import { TransactionFormSkeleton } from '../transactions/TransactionFormSkeleton'
import { EmptyState, ResponsiveSheet } from '../../shared/ui'
import { QuickAddContext, type QuickAddApi } from './quickAddContext'

// Содержимое окна — отдельным чанком (техдолг №37): форма операции с пикерами
// не входит в первую загрузку. Загрузка начинается сразу после первой отрисовки оболочки,
// когда браузер свободен (requestIdleCallback), а не по наведению на «+»: на телефоне
// наведения нет, а между касанием и открытием окна чанк уже не успел бы загрузиться —
// фокус в сумму пришёл бы с задержкой. Повторный `import()` того же модуля браузер
// не загружает заново.
const loadContent = () => import('./QuickAddContent')
const QuickAddContent = lazy(() => loadContent().then((m) => ({ default: m.QuickAddContent })))

/** Подождать, пока браузер освободится (в Safari нет requestIdleCallback — тогда таймер). */
function whenIdle(callback: () => void): () => void {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(callback, { timeout: 3000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(callback, 1500)
  return () => clearTimeout(id)
}

/**
 * Держит состояние окна быстрого ввода. Окно одно на приложение,
 * открыть его можно откуда угодно через `useQuickAdd().open()`.
 */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [opened, { open, close }] = useDisclosure(false)
  const api = useMemo<QuickAddApi>(() => ({ open }), [open])
  const t = useT()
  const queryClient = useQueryClient()

  useEffect(
    () =>
      whenIdle(() => {
        // Ошибку загрузки здесь не показываем: при открытии окна lazy() попробует снова
        // и покажет её в окне.
        loadContent().catch(() => {})
        // Данные формы — заранее, теми же ключами и функциями, что у хуков orval: первое
        // открытие окна не ждёт сети. Счета обычно уже в кэше (главная, онбординг).
        // prefetchQuery ошибок не бросает; при открытии хуки запросят заново.
        void queryClient.prefetchQuery(getListCategoriesQueryOptions())
        void queryClient.prefetchQuery(getListCurrenciesQueryOptions())
        void queryClient.prefetchQuery(getGetTransactionDefaultsQueryOptions())
      }),
    [queryClient],
  )

  return (
    <QuickAddContext.Provider value={api}>
      {children}
      {/* fullHeight: на телефоне быстрый ввод — на всю высоту, клавиатура сразу (ux.md, §3).
          Заодно Select категорий не зацикливает ResizeObserver: высота окна не зависит
          от выпадающего списка (техдолг №36). */}
      <ResponsiveSheet opened={opened} onClose={close} title={t.quickAdd.title} fullHeight>
        <LoadErrorBoundary>
          {/* Чанк не успел загрузиться заранее — скелетон формы (если дольше 300 мс). */}
          <Suspense fallback={<TransactionFormSkeleton />}>
            <QuickAddContent onClose={close} />
          </Suspense>
        </LoadErrorBoundary>
      </ResponsiveSheet>
    </QuickAddContext.Provider>
  )
}

/** Чанк окна не загрузился (нет сети, вышла новая версия) — объяснение вместо пустого окна. */
class LoadErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
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
