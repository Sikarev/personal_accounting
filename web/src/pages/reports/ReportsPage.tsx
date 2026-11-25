import { IconCalendarStats, IconChartLine } from '@tabler/icons-react'
import { useCallback, useMemo } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'

import { paths } from '../../app/navigation'
import { useToday } from '../../features/auth/session'
import { useGetMe, useListAccounts } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { ActiveFilterChips, EmptyState, PageHeader } from '../../shared/ui'
import { CategoryReportTab } from './CategoryReportTab'
import { REPORT_FILTERS, ReportFilterBar } from './ReportFilterBar'
import {
  applyPatch,
  parseReportFilters,
  reportFilterChips,
  reportFiltersToSearchParams,
  type ReportFilters,
  type ReportFiltersPatch,
} from './reportFilters'
import classes from './ReportsPage.module.css'

export type ReportTab = 'categories' | 'monthly' | 'balance'

const TABS: { tab: ReportTab; to: string }[] = [
  { tab: 'categories', to: paths.reportsCategories },
  { tab: 'monthly', to: paths.reportsMonthly },
  { tab: 'balance', to: paths.reportsBalance },
]

/**
 * Фильтры — в адресе страницы, как у ленты. Меняются с `replace`: фильтр — вид отчёта,
 * а не переход, и «Назад» уводит с экрана, а не перебирает периоды.
 */
function useReportFilters(today: string): [ReportFilters, (patch: ReportFiltersPatch) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => parseReportFilters(searchParams, today), [searchParams, today])
  const setFilters = useCallback(
    (patch: ReportFiltersPatch) =>
      setSearchParams(
        (prev) =>
          reportFiltersToSearchParams(
            applyPatch(parseReportFilters(prev, today), patch, today),
            today,
          ),
        { replace: true },
      ),
    [setSearchParams, today],
  )
  return [filters, setFilters]
}

/**
 * Экран «Отчёты» (requirements 5.10, ux.md «Отчёты»): вкладки-ссылки «По категориям»,
 * «По месяцам», «Баланс» (фильтры из адреса переносятся между ними), фильтры периода, счетов
 * и участника, под ними — отчёт вкладки. Грузится лениво вместе с библиотекой графиков.
 */
export function ReportsPage({ tab }: { tab: ReportTab }) {
  const t = useT()
  const today = useToday()
  const { search } = useLocation()
  const me = useGetMe()
  const accountsQuery = useListAccounts()
  const [urlFilters, setFilters] = useReportFilters(today)

  // Фильтр «участник» — только в семье из нескольких человек. Без поля фильтр из адреса
  // не применяется: отчёт молча показывал бы не всё.
  const withAuthors = (me.data?.family.memberCount ?? 1) > 1
  const filters = useMemo(
    () => (withAuthors ? urlFilters : { ...urlFilters, authorId: [] }),
    [urlFilters, withAuthors],
  )
  const meId = me.data?.user.id
  const accounts = useMemo(() => accountsQuery.data?.items ?? [], [accountsQuery.data])
  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])
  const chips = reportFilterChips(filters, { accountNames, today, meId }, t)
  const resetFilters = () => setFilters({ from: null, to: null, accountId: [], authorId: [] })

  return (
    <>
      <PageHeader title={t.nav.reports} />
      <div className={classes.stack}>
        <nav aria-label={t.reports.tabsLabel} className={classes.tabs}>
          {TABS.map((item) => (
            <Link
              key={item.tab}
              // Фильтры (параметры адреса) переходят на другую вкладку вместе с пользователем.
              to={{ pathname: item.to, search }}
              className={classes.tab}
              data-active={item.tab === tab || undefined}
              aria-current={item.tab === tab ? 'page' : undefined}
            >
              {t.reports.tabs[item.tab]}
            </Link>
          ))}
        </nav>

        {tab === 'categories' ? (
          <>
            <ReportFilterBar
              filters={filters}
              onChange={setFilters}
              accounts={accounts}
              today={today}
              withAuthors={withAuthors}
              meId={meId}
            />
            <ActiveFilterChips
              chips={chips}
              onRemove={setFilters}
              onReset={resetFilters}
              fallbackFocus={`[${REPORT_FILTERS}] select`}
            />
            <CategoryReportTab
              filters={filters}
              onChange={setFilters}
              today={today}
              // Пустой отчёт объясняется счетами и участником; период и так виден в выводе.
              filtered={filters.accountId.length > 0 || filters.authorId.length > 0}
              onResetFilters={() => setFilters({ accountId: [], authorId: [] })}
            />
          </>
        ) : (
          <div className={classes.card}>
            <EmptyState
              icon={tab === 'monthly' ? IconCalendarStats : IconChartLine}
              title={t.reports.soon.title}
              description={t.reports.soon[tab]}
            />
          </div>
        )}
      </div>
    </>
  )
}
