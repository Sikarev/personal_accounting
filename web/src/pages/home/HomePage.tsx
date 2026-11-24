import { Paper, Skeleton, Stack, Title, VisuallyHidden } from '@mantine/core'
import { lazy, Suspense, useEffect, useId, useState } from 'react'

import { ChunkLoadBoundary } from '../../features/transactions/ChunkLoadBoundary'

import { useOnboarding } from '../../features/onboarding/onboardingContext'
import { QuickAddIntro } from '../../features/onboarding/QuickAddIntro'
import { useGetMe, useListAccounts, useListCategories, useListTransactions } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import { useMobileLayout } from '../../shared/lib/useMobileLayout'
import { PageHeader, TransactionListSkeleton } from '../../shared/ui'
import { BlockError } from './BlockError'
import {
  focusHomeForm,
  focusWhenPresent,
  HOME_PRIMARY_ACTION,
  RECENT_ALL_LINK,
} from './focusTargets'
import { HomeAccounts } from './HomeAccounts'
import { HomeQuickAddForm } from './HomeQuickAddForm'
import classes from './HomePage.module.css'

// Шаг 1 онбординга с формой счёта нужен только новому пользователю, один раз, — грузится
// отдельным чанком, общим с экраном «Счета», а не в первую загрузку (ux.md, раздел 8).
// Загрузчик вынесен, чтобы начать загрузку чанка заранее, параллельно с GET /accounts:
// иначе новый пользователь ждал бы два сетевых круга подряд (список, потом чанк).
// Повторный import() того же модуля не грузит его второй раз.
const loadFirstAccountStep = () => import('../../features/onboarding/FirstAccountStep')
const FirstAccountStep = lazy(() =>
  loadFirstAccountStep().then((m) => ({ default: m.FirstAccountStep })),
)

// Последние операции — строки с меню, окно правки, удаление с отменой — отдельным чанком:
// без них первая загрузка легче (ux.md, раздел 8), баланс и счета рисуются сразу.
// Чанк грузится сразу при открытии главной, параллельно с запросами данных.
const loadRecent = () => import('./RecentTransactions')
const RecentTransactions = lazy(() => loadRecent().then((m) => ({ default: m.RecentTransactions })))

/** Сколько последних операций на главной (ux.md, «Главная»: 5–10). */
const RECENT_PARAMS = { limit: 10 }

/**
 * Главная (ux.md, «Главная»; requirements, раздел 6). Главный ответ — «сколько у меня денег»:
 * крупно общий баланс по валютам, под ним счета (общие и личные, сворачиваются), последние
 * операции по дням; на desktop — форма быстрого ввода прямо на странице.
 *
 * Блоки грузятся и ошибаются независимо: баланс со счетами (`GET /accounts`) и последние
 * операции. Запросы уходят сразу и параллельно.
 *
 * Нет ни одного видимого счёта (ни активного, ни архивного) — онбординг: создать первый
 * счёт (шаг 1), затем узнать, где вносить операции (шаг 2). Флага «онбординг пройден» нет:
 * счёт появился — шаг 1 больше не показывается.
 */
export function HomePage() {
  const t = useT()
  const mobile = useMobileLayout()
  const onboarding = useOnboarding()
  const accountsQuery = useListAccounts()
  const recentQuery = useListTransactions(RECENT_PARAMS)
  const categoriesQuery = useListCategories()
  const me = useGetMe()
  // Счета без данных уже не загрузились. TanStack Query при повторе запроса без данных
  // сбрасывает ошибку и снова считает его «ожидающим» — по счётчику ошибок (он при повторе
  // не сбрасывается) блок ошибки остаётся на месте, а не сменяется скелетоном всей главной.
  // Фоновая ошибка при уже загруженных данных ничего не меняет: показываем данные.
  const accountsFailed =
    !accountsQuery.data && (accountsQuery.isError || accountsQuery.errorUpdateCount > 0)
  const firstLoad = accountsQuery.isPending && !accountsFailed
  const showSkeleton = useDelayedLoading(firstLoad)
  // Скелетон уже показан — пока догружается чанк шага 1, держим его без новой задержки,
  // иначе было бы «скелетон → пусто → форма».
  const [skeletonShown, setSkeletonShown] = useState(false)
  if (showSkeleton && !skeletonShown) setSkeletonShown(true)

  // Холодная загрузка главной: списка счетов ещё нет — грузим чанк шага 1 параллельно.
  // Пользователю со счетами это стоит ~1 КБ gzip (и тот же чанк нужен экрану «Счета»).
  const coldStart = accountsQuery.isPending
  useEffect(() => {
    // Ошибку загрузки здесь глушим: её покажет RouteBoundary, когда шаг 1 понадобится.
    if (coldStart) loadFirstAccountStep().catch(() => {})
  }, [coldStart])
  useEffect(() => {
    // Ошибку загрузки покажет ChunkLoadBoundary блока.
    loadRecent().catch(() => {})
  }, [])

  // Карточка шага 2 исчезает вместе с «Понятно» — фокус на главное действие экрана:
  // desktop — сумма в форме на странице, mobile — «Добавить операцию» пустого блока.
  // Операции уже есть (пустого блока нет) — «Все операции»; не дождались — заголовок экрана.
  const afterIntro = () =>
    mobile
      ? focusWhenPresent(`[${HOME_PRIMARY_ACTION}], [${RECENT_ALL_LINK}]`, () => {
          // Заголовок сам по себе не фокусируется — только программно (tabindex="-1").
          const heading = document.querySelector<HTMLElement>('main h1')
          heading?.setAttribute('tabindex', '-1')
          return heading
        })
      : focusHomeForm()

  // Шаг 2 на телефоне — одна карточка: она указывает на «+» в нижней панели.
  if (onboarding.introVisible && mobile) {
    return (
      <>
        <PageHeader title={t.nav.home} />
        <QuickAddIntro onDismiss={afterIntro} />
      </>
    )
  }

  if (firstLoad) return showSkeleton ? <HomeSkeleton /> : null

  if (accountsQuery.data?.items.length === 0) {
    return (
      <Suspense fallback={<HomeSkeleton delayed={!skeletonShown} />}>
        <FirstAccountStep />
      </Suspense>
    )
  }

  const accountsBlock = accountsQuery.data ? (
    <HomeAccounts accounts={accountsQuery.data.items} />
  ) : (
    <BlockError
      title={t.home.accountsLoadError}
      error={accountsQuery.error}
      retrying={accountsQuery.isFetching}
      onRetry={() => void accountsQuery.refetch()}
    />
  )

  // Форма без счетов не работает, а её собственный запрос счетов после ошибки снова
  // перезапрашивал бы их при каждом появлении — повторяет загрузку только «Повторить» блока.
  const withForm = !mobile && accountsQuery.data !== undefined

  return (
    <>
      <PageHeader title={t.nav.home} />
      {/* Шаг 2 на desktop — над главной: карточка указывает на форму на странице. */}
      {onboarding.introVisible && (
        <div className={classes.intro}>
          <QuickAddIntro onDismiss={afterIntro} onAddFirst={focusHomeForm} />
        </div>
      )}
      <div className={classes.layout}>
        <div className={classes.grid} data-with-form={withForm || undefined}>
          <div className={classes.accountsArea}>{accountsBlock}</div>
          {withForm && (
            <div className={classes.formArea}>
              <HomeQuickAddForm />
            </div>
          )}
          <div className={classes.recentArea}>
            <ChunkLoadBoundary>
              <Suspense fallback={<RecentFallback />}>
                <RecentTransactions
                  query={recentQuery}
                  categoriesQuery={categoriesQuery}
                  accounts={accountsQuery.data?.items ?? null}
                  showAuthor={(me.data?.family.memberCount ?? 1) > 1}
                  withForm={withForm}
                />
              </Suspense>
            </ChunkLoadBoundary>
          </div>
        </div>
      </div>
    </>
  )
}

/** Пока грузится чанк последних операций: заголовок блока и скелетон (если дольше 300 мс). */
function RecentFallback() {
  const t = useT()
  const headingId = useId()
  const show = useDelayedLoading(true)
  return (
    <section aria-labelledby={headingId} className={classes.recent}>
      <div className={classes.blockHeader}>
        <Title id={headingId} order={2} size="lg">
          {t.home.recentTitle}
        </Title>
      </div>
      {show && <TransactionListSkeleton groups={2} rowsPerGroup={2} />}
    </section>
  )
}

/**
 * Скелетон главной в форме контента: заголовок, баланс со счетами, последние операции.
 * `delayed` — для Suspense: у него своя задержка в 300 мс, как у запроса (ux.md, раздел 4:
 * быстрый ответ — без мигания).
 */
function HomeSkeleton({ delayed }: { delayed?: boolean }) {
  const t = useT()
  const show = useDelayedLoading(Boolean(delayed))
  if (delayed && !show) return null
  return (
    <div role="status" aria-live="polite">
      <VisuallyHidden>{t.common.loading}</VisuallyHidden>
      <Stack gap="lg" aria-hidden>
        <Skeleton className={classes.skeletonTitle} radius="sm" />
        <Paper withBorder radius="lg" p="md">
          <Skeleton className={classes.skeletonLabel} radius="sm" />
          <Skeleton className={classes.skeletonBalance} radius="sm" mt="sm" />
          <Stack gap="md" mt="lg">
            {['60%', '45%'].map((width) => (
              <Skeleton key={width} className={classes.skeletonRow} w={width} radius="sm" />
            ))}
          </Stack>
        </Paper>
        <TransactionListSkeleton groups={1} rowsPerGroup={3} />
      </Stack>
    </div>
  )
}
