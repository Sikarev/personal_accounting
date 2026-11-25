import { Button, Text, Title } from '@mantine/core'
import { IconWallet } from '@tabler/icons-react'
import { keepPreviousData } from '@tanstack/react-query'
import { useId } from 'react'
import { Link } from 'react-router'

import { paths } from '../../app/navigation'
import { useGetBalanceReport, type Account, type BalanceReport } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { formatPeriod } from '../../shared/lib/date'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import { EmptyState, Money } from '../../shared/ui'
import { BalanceChart } from './BalanceChart'
import { BalanceTable } from './BalanceTable'
import { isPeriodTooLong, toBalanceReportParams, type ReportFilters } from './reportFilters'
import { MissingRatesNotice, ReportError, ReportFrame, TooLongState } from './reportParts'
import { failedQueries, useShownFilters } from './reportQuery'
import { periodLabel } from './reportPeriod'
import { ReportSkeleton } from './ReportSkeleton'
import { balanceChange } from './trendReport'
import classes from './ReportsPage.module.css'

/** Почему баланс показать не из чего: счетов нет или ни один не входит в общий баланс. */
type NoBalance = 'noAccounts' | 'noneInTotal' | null

/**
 * Без фильтра счетов баланс складывается из видимых счетов с «Учитывать в общем балансе»
 * (архивные тоже: в прошлом на них были деньги). Нет таких — API вернул бы ряд нулей,
 * и линия по нулю выдавала бы себя за «денег нет». С фильтром — ровно выбранные счета.
 */
function noBalance(accounts: readonly Account[], filters: ReportFilters): NoBalance {
  if (accounts.length === 0) return 'noAccounts'
  if (filters.accountId.length === 0 && !accounts.some((a) => a.includeInTotal)) {
    return 'noneInTotal'
  }
  return null
}

/**
 * Вкладка «Баланс» (requirements 5.10): растут деньги или тают. Сначала вывод — остаток
 * на конец периода и изменение с первой точки, — потом линия и таблица значений.
 * Фильтра участника нет: у остатка нет автора.
 */
export function BalanceReportTab({
  filters,
  today,
  accounts,
  accountsPending,
}: {
  filters: ReportFilters
  today: string
  accounts: readonly Account[]
  accountsPending: boolean
}) {
  const tooLong = isPeriodTooLong(filters)
  const empty = accountsPending ? null : noBalance(accounts, filters)
  const params = toBalanceReportParams(filters)
  const report = useGetBalanceReport(params, {
    query: { enabled: !tooLong && !accountsPending && !empty, placeholderData: keepPreviousData },
  })
  const { stale, shownFilters } = useShownFilters(report, JSON.stringify(params), filters)

  const isPending = !tooLong && !empty && (accountsPending || report.isPending)
  const showSkeleton = useDelayedLoading(isPending)
  const failed = failedQueries([report])

  let content
  if (tooLong) {
    content = <TooLongState />
  } else if (empty) {
    content = <NoBalanceState reason={empty} />
  } else if (failed.length > 0) {
    content = <ReportError failed={failed} />
  } else if (isPending || !report.data) {
    content = showSkeleton ? <ReportSkeleton chart="trend" /> : null
  } else {
    content = (
      <BalanceBody report={report.data} filters={shownFilters} stale={stale} today={today} />
    )
  }
  return <div aria-busy={stale || undefined}>{content}</div>
}

function NoBalanceState({ reason }: { reason: 'noAccounts' | 'noneInTotal' }) {
  const t = useT()
  const texts = t.reports.balance[reason]
  return (
    <div className={classes.card}>
      <EmptyState
        icon={IconWallet}
        title={texts.title}
        description={texts.description}
        action={
          <Button
            component={Link}
            to={paths.accounts}
            variant={reason === 'noAccounts' ? 'light' : 'default'}
            size="md"
            className={classes.touchButton}
          >
            {reason === 'noAccounts' ? t.accounts.create : t.reports.balance.noneInTotal.action}
          </Button>
        }
      />
    </div>
  )
}

function BalanceBody({
  report,
  filters,
  stale,
  today,
}: {
  report: BalanceReport
  /** Фильтры, по которым получен `report` (во время загрузки новых — прежние). */
  filters: ReportFilters
  stale: boolean
  today: string
}) {
  const t = useT()
  const headingId = useId()
  const b = t.reports.balance
  const last = report.items[report.items.length - 1]
  const change = balanceChange(report.items, report.currency)
  if (!last) return null

  return (
    <ReportFrame stale={stale}>
      <MissingRatesNotice codes={report.missingRates} text={b.missingRates(report.missingRates)} />
      <section aria-labelledby={headingId} className={classes.report}>
        <div className={classes.headline}>
          {/* Главная мысль экрана — крупно (ux.md, раздел 1). */}
          <Title order={2} size="xl" id={headingId} className={classes.headlineText}>
            {b.headline(formatPeriod(last.date, last.date, today))}{' '}
            <Money
              amount={last.balance}
              currency={report.currency}
              roundToMajor
              variant="balance"
              wrap
            />
          </Title>
          {change && (
            <Text c="dimmed">
              {change.direction === 'same' ? (
                b.same(formatPeriod(change.since, change.since, today))
              ) : (
                <>
                  {b[change.direction](formatPeriod(change.since, change.since, today))}{' '}
                  <Money amount={change.amount} currency={report.currency} roundToMajor wrap />
                </>
              )}
            </Text>
          )}
        </div>
        <BalanceChart
          items={report.items}
          step={report.step}
          currency={report.currency}
          filters={filters}
          today={today}
        />
        <BalanceTable
          items={report.items}
          currency={report.currency}
          today={today}
          caption={b.table.caption(periodLabel(filters, today, t))}
        />
      </section>
    </ReportFrame>
  )
}
