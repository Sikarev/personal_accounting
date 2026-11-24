import { Button, Paper, Skeleton, Text, Title, VisuallyHidden } from '@mantine/core'
import { useId, type ReactNode } from 'react'

import { apiErrorText, type TransactionSummary } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { summaryStats } from '../../shared/lib/transactionFeed'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import { useMobileLayout } from '../../shared/lib/useMobileLayout'
import { Money } from '../../shared/ui'
import classes from './TransactionsPage.module.css'

type SummaryQuery = {
  data: TransactionSummary | undefined
  isPending: boolean
  isError: boolean
  isFetching: boolean
  error: unknown
  refetch: () => unknown
}

/**
 * Итоги выборки (requirements 5.8): расходы, доходы и разница — по каждой валюте
 * отдельно (пересчёта в рубли нет до этапа 4). Переводы и корректировки в итоги не входят.
 */
export function FeedSummary({ query, filtered }: { query: SummaryQuery; filtered: boolean }) {
  const t = useT()
  const titleId = useId()
  const showSkeleton = useDelayedLoading(query.isPending)
  const mobile = useMobileLayout()

  let content
  if (query.isPending) {
    content = showSkeleton ? (
      <div role="status" aria-live="polite" className={classes.summaryStats}>
        <VisuallyHidden>{t.common.loading}</VisuallyHidden>
        {[0, 1, 2].map((i) => (
          <div key={i} aria-hidden>
            <Skeleton className={classes.skeletonLabel} radius="sm" />
            <Skeleton className={classes.skeletonValue} radius="sm" mt="xs" />
          </div>
        ))}
      </div>
    ) : null
  } else if (query.isError && !query.data) {
    content = (
      <div className={classes.inlineError}>
        <Text size="sm">
          {t.feed.summary.loadError} {apiErrorText(query.error, t)}
        </Text>
        <Button
          variant="default"
          size="sm"
          className={classes.touchButton}
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t.errors.retry}
        </Button>
      </div>
    )
  } else if (!query.data || !query.data.totals.some((total) => summaryStats(total).length)) {
    content = (
      <Text size="sm" c="dimmed">
        {t.feed.summary.empty}
      </Text>
    )
  } else {
    content = query.data.totals
      .map((total) => ({ currency: total.currency, stats: summaryStats(total) }))
      .filter((row) => row.stats.length > 0)
      .map((row) => (
        <dl key={row.currency} className={mobile ? classes.summaryInline : classes.summaryStats}>
          {row.stats.map((stat) => (
            <Stat key={stat.key} label={t.feed.summary[stat.key]} compact={mobile}>
              <Money amount={stat.amount} currency={row.currency} variant="flow" wrap />
            </Stat>
          ))}
        </dl>
      ))
  }

  return (
    // На телефоне итоги компактные — по строке на валюту обычным кеглем: главное на экране —
    // лента (ux.md, принцип 2), а крупные цифры заняли бы пол-экрана, при крупном шрифте — весь.
    <Paper
      withBorder
      radius="lg"
      p={mobile ? 'sm' : 'md'}
      component="section"
      aria-labelledby={titleId}
    >
      <Title id={titleId} order={2} size="sm" fw={500} c="dimmed" mb={mobile ? 'xs' : 'sm'}>
        {filtered ? t.feed.summary.filteredTitle : t.feed.summary.title}
      </Title>
      <div className={mobile ? classes.summaryBodyCompact : classes.summaryBody}>{content}</div>
    </Paper>
  )
}

function Stat({
  label,
  compact,
  children,
}: {
  label: string
  compact: boolean
  children: ReactNode
}) {
  return (
    <div className={compact ? classes.statInline : classes.stat}>
      <Text component="dt" size={compact ? 'sm' : 'xs'} c="dimmed">
        {label}
      </Text>
      <Text component="dd" size={compact ? 'sm' : 'lg'} fw={600} className={classes.statValue}>
        {children}
      </Text>
    </div>
  )
}
