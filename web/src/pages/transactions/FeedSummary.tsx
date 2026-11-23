import { Button, Paper, Skeleton, Text, Title, VisuallyHidden } from '@mantine/core'
import { useId, type ReactNode } from 'react'

import { apiErrorText, type TransactionSummary } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
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
  } else if (!query.data || query.data.totals.length === 0) {
    content = (
      <Text size="sm" c="dimmed">
        {t.feed.summary.empty}
      </Text>
    )
  } else {
    content = query.data.totals.map((total) => (
      <dl key={total.currency} className={classes.summaryStats}>
        <Stat label={t.feed.summary.expense}>
          <Money amount={-total.expense} currency={total.currency} variant="flow" wrap />
        </Stat>
        <Stat label={t.feed.summary.income}>
          <Money amount={total.income} currency={total.currency} variant="flow" wrap />
        </Stat>
        <Stat label={t.feed.summary.difference}>
          <Money
            amount={total.income - total.expense}
            currency={total.currency}
            variant="flow"
            wrap
          />
        </Stat>
      </dl>
    ))
  }

  return (
    <Paper withBorder radius="lg" p="md" component="section" aria-labelledby={titleId}>
      <Title id={titleId} order={2} size="sm" fw={500} c="dimmed" mb="sm">
        {filtered ? t.feed.summary.filteredTitle : t.feed.summary.title}
      </Title>
      <div className={classes.summaryBody}>{content}</div>
    </Paper>
  )
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={classes.stat}>
      <Text component="dt" size="xs" c="dimmed">
        {label}
      </Text>
      <Text component="dd" size="lg" fw={600} className={classes.statValue}>
        {children}
      </Text>
    </div>
  )
}
