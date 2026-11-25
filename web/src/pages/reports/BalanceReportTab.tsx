import { Button, Text, Title } from '@mantine/core'
import { IconCalendarTime, IconWallet } from '@tabler/icons-react'
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
import { periodLabel } from './reportPeriod'
import { failedQueries, useShownFilters, type FailingQuery } from './reportQuery'
import { ReportSkeleton } from './ReportSkeleton'
import { balanceChange, balancePeriod, balanceStartDate } from './trendReport'
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

/** Запрос списка счетов (`useListAccounts`): по нему решаем, есть ли из чего строить баланс. */
type AccountsQuery = FailingQuery & { data?: { items: Account[] }; isPending: boolean }

/**
 * Вкладка «Баланс» (requirements 5.10): растут деньги или тают. Сначала вывод — остаток
 * на конец периода и изменение за период, — потом линия и таблица значений.
 * Фильтра участника нет: у остатка нет автора.
 *
 * Период запроса обрезан «сегодня» (`balancePeriod`): будущее — ровная линия, а не данные.
 * Изменение за период — от остатка на начало периода: вторым запросом той же выборки
 * из одной точки (`to = from = день перед периодом`). Его ошибка или ожидание отчёт
 * не ломают: строка изменения просто не показывается (место под неё занято).
 */
export function BalanceReportTab({
  filters,
  today,
  accountsQuery,
}: {
  filters: ReportFilters
  today: string
  accountsQuery: AccountsQuery
}) {
  const period = balancePeriod(filters, today)
  const tooLong = isPeriodTooLong(filters)
  const accounts = accountsQuery.data?.items
  // «Нет счетов» — только по полученному списку: ошибка загрузки счетов — это ошибка.
  const empty = accounts ? noBalance(accounts, filters) : null
  const enabled = period !== null && !tooLong && accounts !== undefined && !empty

  const params = toBalanceReportParams(period ?? filters)
  const report = useGetBalanceReport(params, {
    query: { enabled, placeholderData: keepPreviousData },
  })
  const startDate = balanceStartDate(period ?? filters)
  const start = useGetBalanceReport(
    { ...params, from: startDate, to: startDate },
    {
      query: { enabled },
    },
  )
  const { stale, shownFilters } = useShownFilters(report, JSON.stringify(params), period ?? filters)

  const isPending = enabled ? report.isPending : accountsQuery.isPending
  const showSkeleton = useDelayedLoading(isPending)
  const failed = failedQueries(enabled ? [report] : [accountsQuery])

  // Остаток на начало — только для текущих фильтров и пока на экране не прежний отчёт.
  const startBalance = !stale ? start.data?.items[0]?.balance : undefined
  const changePending = stale || start.isPending

  let content
  if (period === null) {
    content = <FutureState />
  } else if (tooLong) {
    content = <TooLongState />
  } else if (failed.length > 0) {
    content = <ReportError failed={failed} />
  } else if (empty) {
    content = <NoBalanceState reason={empty} />
  } else if (isPending || !report.data) {
    content = showSkeleton ? <ReportSkeleton chart="trend" /> : null
  } else {
    content = (
      <BalanceBody
        report={report.data}
        startBalance={startBalance}
        changePending={changePending}
        filters={shownFilters}
        stale={stale}
        today={today}
      />
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

/** Весь период — в будущем: остатка там ещё нет. */
function FutureState() {
  const t = useT()
  return (
    <div className={classes.card}>
      <EmptyState
        icon={IconCalendarTime}
        title={t.reports.balance.future.title}
        description={t.reports.balance.future.description}
      />
    </div>
  )
}

function BalanceBody({
  report,
  startBalance,
  changePending,
  filters,
  stale,
  today,
}: {
  report: BalanceReport
  /** Остаток на начало периода; `undefined` — неизвестен (ждём или запрос не удался). */
  startBalance: number | undefined
  /** Остаток на начало ещё грузится: место под строку изменения занято. */
  changePending: boolean
  /** Фильтры, по которым получен `report` (во время загрузки новых — прежние). */
  filters: ReportFilters
  stale: boolean
  today: string
}) {
  const t = useT()
  const headingId = useId()
  const b = t.reports.balance
  const last = report.items[report.items.length - 1]
  const change =
    startBalance === undefined ? null : balanceChange(startBalance, report.items, report.currency)
  if (!last) return null
  const since = formatPeriod(filters.from, filters.from, today)

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
              className={classes.inlineAmount}
            />
          </Title>
          {change ? (
            <Text c="dimmed">
              {change.direction === 'same' ? (
                b.same(since)
              ) : (
                <>
                  {b[change.direction](since)}{' '}
                  <Money
                    amount={change.amount}
                    currency={report.currency}
                    roundToMajor
                    wrap
                    className={classes.inlineAmount}
                  />
                </>
              )}
            </Text>
          ) : (
            changePending && (
              <Text c="dimmed" aria-hidden>
                {' '}
              </Text>
            )
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
