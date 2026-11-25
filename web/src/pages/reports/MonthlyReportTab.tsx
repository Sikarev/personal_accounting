import { Text, Title } from '@mantine/core'
import { IconCalendarStats } from '@tabler/icons-react'
import { keepPreviousData } from '@tanstack/react-query'
import { useId, useMemo } from 'react'

import { useGetMonthlyReport, type MonthlyReport } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { formatCount } from '../../shared/lib/plural'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import { Money } from '../../shared/ui'
import { MonthlyChart } from './MonthlyChart'
import { MonthlyTable } from './MonthlyTable'
import { isPeriodTooLong, toMonthlyReportParams, type ReportFilters } from './reportFilters'
import {
  MissingRatesNotice,
  NoOperationsState,
  ReportError,
  ReportFrame,
  TooLongState,
} from './reportParts'
import { failedQueries, useShownFilters } from './reportQuery'
import { periodLabel, periodLead } from './reportPeriod'
import { ReportSkeleton } from './ReportSkeleton'
import { averageExpense, differenceDirection, isMonthlyEmpty, monthlyTotals } from './trendReport'
import classes from './ReportsPage.module.css'

/**
 * Вкладка «По месяцам» (requirements 5.10): тратит ли человек больше, чем зарабатывает,
 * и как это меняется. Сначала вывод текстом — кто больше за период и на сколько, средний
 * расход за полный месяц, — потом столбцы с линией разницы и таблица.
 */
export function MonthlyReportTab({
  filters,
  today,
  filtered,
  onResetFilters,
}: {
  filters: ReportFilters
  today: string
  /** Заданы счета или участник: пустой отчёт объясняется ими и снимается «Сбросить фильтры». */
  filtered: boolean
  onResetFilters: () => void
}) {
  const tooLong = isPeriodTooLong(filters)
  const params = toMonthlyReportParams(filters)
  const report = useGetMonthlyReport(params, {
    // Пока грузится отчёт с новыми фильтрами, на экране остаётся прежний — без мигания,
    // но приглушённый и со своими (прежними) фильтрами.
    query: { enabled: !tooLong, placeholderData: keepPreviousData },
  })
  const { stale, shownFilters } = useShownFilters(report, JSON.stringify(params), filters)

  const isPending = !tooLong && report.isPending
  const showSkeleton = useDelayedLoading(isPending)
  const failed = failedQueries([report])

  let content
  if (tooLong) {
    content = <TooLongState />
  } else if (failed.length > 0) {
    content = <ReportError failed={failed} />
  } else if (isPending || !report.data) {
    content = showSkeleton ? <ReportSkeleton chart="trend" /> : null
  } else {
    content = (
      <MonthlyBody
        report={report.data}
        filters={shownFilters}
        stale={stale}
        today={today}
        filtered={filtered}
        onResetFilters={onResetFilters}
      />
    )
  }
  return <div aria-busy={stale || undefined}>{content}</div>
}

function MonthlyBody({
  report,
  filters,
  stale,
  today,
  filtered,
  onResetFilters,
}: {
  report: MonthlyReport
  /** Фильтры, по которым получен `report` (во время загрузки новых — прежние). */
  filters: ReportFilters
  stale: boolean
  today: string
  filtered: boolean
  onResetFilters: () => void
}) {
  const t = useT()
  const headingId = useId()
  const totals = useMemo(() => monthlyTotals(report.items), [report.items])
  const average = averageExpense(report.items, filters, today)
  const m = t.reports.monthly

  if (isMonthlyEmpty(report.items)) {
    return (
      <ReportFrame stale={stale}>
        <MissingRatesNotice codes={report.missingRates} />
        <NoOperationsState
          icon={IconCalendarStats}
          title={m.empty}
          filtered={filtered}
          onResetFilters={onResetFilters}
        />
      </ReportFrame>
    )
  }

  const direction = differenceDirection(totals.difference, report.currency)
  const abs = totals.difference < 0n ? -totals.difference : totals.difference

  return (
    <ReportFrame stale={stale}>
      <MissingRatesNotice codes={report.missingRates} />
      <section aria-labelledby={headingId} className={classes.report}>
        <div className={classes.headline}>
          {/* Главная мысль экрана — крупно (ux.md, раздел 1). */}
          <Title order={2} size="xl" id={headingId} className={classes.headlineText}>
            {periodLead(filters, today, t)}{' '}
            {direction === 'equal' ? (
              m.equal
            ) : (
              <>
                {m[direction]}{' '}
                <Money
                  amount={abs}
                  currency={report.currency}
                  roundToMajor
                  wrap
                  className={classes.inlineAmount}
                />
              </>
            )}
          </Title>
          {average && (
            <Text c="dimmed">
              {m.averageLead}{' '}
              <Money
                amount={average.amount}
                currency={report.currency}
                roundToMajor
                wrap
                className={classes.inlineAmount}
              />{' '}
              {m.averageTail(formatCount(average.months, m.fullMonths))}
            </Text>
          )}
        </div>
        <MonthlyChart items={report.items} currency={report.currency} filters={filters} />
        <MonthlyTable
          items={report.items}
          totals={totals}
          currency={report.currency}
          filters={filters}
          caption={m.table.caption(periodLabel(filters, today, t))}
        />
      </section>
    </ReportFrame>
  )
}
