import { Button, Paper, Skeleton, Stack, VisuallyHidden } from '@mantine/core'
import { IconAlertCircle, IconHome2 } from '@tabler/icons-react'
import { lazy, Suspense } from 'react'

import { useOnboarding } from '../features/onboarding/onboardingContext'
import { QuickAddIntro } from '../features/onboarding/QuickAddIntro'
import { apiErrorText, useListAccounts } from '../shared/api'
import { useT } from '../shared/i18n'
import { useDelayedLoading } from '../shared/lib/useDelayedLoading'
import { EmptyState, PageHeader } from '../shared/ui'
import classes from './HomePage.module.css'
import { StubPage, STUB_ACTION } from './StubPage'

// Шаг 1 онбординга с формой счёта нужен только новому пользователю, один раз, — грузится
// отдельным чанком, общим с экраном «Счета», а не в первую загрузку (ux.md, раздел 8).
const FirstAccountStep = lazy(() =>
  import('../features/onboarding/FirstAccountStep').then((m) => ({
    default: m.FirstAccountStep,
  })),
)

/**
 * Главная. Пока без баланса и ленты (этап 3) — заглушка; но если у пользователя нет ни
 * одного видимого счёта (ни активного, ни архивного), вместо неё онбординг: создать первый
 * счёт (шаг 1), затем узнать, где вносить операции (шаг 2). Флага «онбординг пройден» нет:
 * счёт появился — шаг 1 больше не показывается.
 */
export function HomePage() {
  const t = useT()
  const onboarding = useOnboarding()
  const query = useListAccounts()
  const showSkeleton = useDelayedLoading(query.isPending)

  if (onboarding.introVisible) {
    return (
      <>
        <PageHeader title={t.nav.home} />
        <QuickAddIntro
          // Карточка исчезает вместе с кнопкой «Понятно» — фокус на главное действие экрана.
          onDismiss={() =>
            requestAnimationFrame(() =>
              document.querySelector<HTMLElement>(`[${STUB_ACTION}]`)?.focus(),
            )
          }
        />
      </>
    )
  }

  if (query.isPending) return showSkeleton ? <HomeSkeleton /> : null

  if (query.isError && !query.data) {
    return (
      <>
        <PageHeader title={t.nav.home} />
        <Paper withBorder radius="lg">
          <EmptyState
            icon={IconAlertCircle}
            title={t.accounts.loadError}
            description={apiErrorText(query.error, t)}
            action={
              <Button
                variant="default"
                size="md"
                loading={query.isFetching}
                onClick={() => void query.refetch()}
              >
                {t.errors.retry}
              </Button>
            }
          />
        </Paper>
      </>
    )
  }

  if (query.data.items.length === 0) {
    return (
      <Suspense fallback={<HomeSkeleton delayed />}>
        <FirstAccountStep />
      </Suspense>
    )
  }

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

/**
 * Скелетон главной: заголовок и блок. `delayed` — для Suspense: у него своя задержка
 * в 300 мс, как у запроса (ux.md, раздел 4: быстрый ответ — без мигания).
 */
function HomeSkeleton({ delayed }: { delayed?: boolean }) {
  const t = useT()
  const show = useDelayedLoading(Boolean(delayed))
  if (delayed && !show) return null
  return (
    <div role="status" aria-live="polite">
      <VisuallyHidden>{t.common.loading}</VisuallyHidden>
      <Stack gap="md" aria-hidden>
        <Skeleton className={classes.title} radius="sm" />
        <Skeleton className={classes.block} radius="lg" />
      </Stack>
    </div>
  )
}
