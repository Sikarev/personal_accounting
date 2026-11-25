import { useCallback, useMemo } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'

import { paths } from '../../app/navigation'
import { useToday } from '../../features/auth/session'
import { useGetMe, useListAccounts } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { ActiveFilterChips, PageHeader } from '../../shared/ui'
import { BalanceReportTab } from './BalanceReportTab'
import { CategoryReportTab } from './CategoryReportTab'
import { MonthlyReportTab } from './MonthlyReportTab'
import { REPORT_FILTERS, ReportFilterBar } from './ReportFilterBar'
import {
  applyPatch,
  DEFAULT_REPORT_PRESET,
  DEFAULT_TREND_PRESET,
  parseReportFilters,
  reportFilterChips,
  reportFiltersToSearchParams,
  type ReportDefaultPreset,
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

/** Период по умолчанию: по категориям — текущий месяц, тренды — 12 месяцев. */
const DEFAULT_PRESETS: Record<ReportTab, ReportDefaultPreset> = {
  categories: DEFAULT_REPORT_PRESET,
  monthly: DEFAULT_TREND_PRESET,
  balance: DEFAULT_TREND_PRESET,
}

/**
 * Фильтры — в адресе страницы, как у ленты. Меняются с `replace`: фильтр — вид отчёта,
 * а не переход, и «Назад» уводит с экрана, а не перебирает периоды. Период вкладки
 * по умолчанию в адрес не пишется — у каждой вкладки он свой.
 */
function useReportFilters(
  today: string,
  defaultPreset: ReportDefaultPreset,
): [ReportFilters, (patch: ReportFiltersPatch) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(
    () => parseReportFilters(searchParams, today, defaultPreset),
    [searchParams, today, defaultPreset],
  )
  const setFilters = useCallback(
    (patch: ReportFiltersPatch) =>
      setSearchParams(
        (prev) =>
          reportFiltersToSearchParams(
            applyPatch(parseReportFilters(prev, today, defaultPreset), patch, today, defaultPreset),
            today,
            defaultPreset,
          ),
        { replace: true },
      ),
    [setSearchParams, today, defaultPreset],
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
  const defaultPreset = DEFAULT_PRESETS[tab]
  const [urlFilters, setFilters] = useReportFilters(today, defaultPreset)

  // Фильтр «участник» — только в семье из нескольких человек. Без поля фильтр из адреса
  // не применяется: отчёт молча показывал бы не всё. У баланса участника нет вовсе:
  // у остатка нет автора (API его не принимает); в адресе он остаётся для других вкладок.
  const withAuthors = (me.data?.family.memberCount ?? 1) > 1 && tab !== 'balance'
  const filters = useMemo(
    () => (withAuthors ? urlFilters : { ...urlFilters, authorId: [] }),
    [urlFilters, withAuthors],
  )
  const meId = me.data?.user.id
  const accounts = useMemo(() => accountsQuery.data?.items ?? [], [accountsQuery.data])
  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])
  const chips = reportFilterChips(filters, { accountNames, today, meId, defaultPreset }, t)
  const resetFilters = () => setFilters({ from: null, to: null, accountId: [], authorId: [] })
  // Пустой отчёт объясняется счетами и участником; период и так виден в фильтрах.
  const filtered = filters.accountId.length > 0 || filters.authorId.length > 0
  const resetExtraFilters = () => setFilters({ accountId: [], authorId: [] })

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

        <ReportFilterBar
          filters={filters}
          onChange={setFilters}
          accounts={accounts}
          today={today}
          withAuthors={withAuthors}
          meId={meId}
          defaultPreset={defaultPreset}
        />
        <ActiveFilterChips
          chips={chips}
          onRemove={setFilters}
          onReset={resetFilters}
          fallbackFocus={`[${REPORT_FILTERS}] select`}
        />
        {tab === 'categories' && (
          <CategoryReportTab
            filters={filters}
            onChange={setFilters}
            today={today}
            filtered={filtered}
            onResetFilters={resetExtraFilters}
          />
        )}
        {tab === 'monthly' && (
          <MonthlyReportTab
            filters={filters}
            today={today}
            filtered={filtered}
            onResetFilters={resetExtraFilters}
          />
        )}
        {tab === 'balance' && (
          <BalanceReportTab filters={filters} today={today} accountsQuery={accountsQuery} />
        )}
      </div>
    </>
  )
}
