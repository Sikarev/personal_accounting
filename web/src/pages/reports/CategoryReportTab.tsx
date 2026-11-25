import { Text, Title } from '@mantine/core'
import { IconChartPie } from '@tabler/icons-react'
import { keepPreviousData } from '@tanstack/react-query'
import { useId, useMemo, useState, type ReactNode } from 'react'

import kindClasses from '../../features/transactions/KindSwitch.module.css'
import { useGetCategoryReport, useListCategories, type CategoryReport } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import { Money } from '../../shared/ui'
import { CategoryDonut } from './CategoryDonut'
import { CategoryTable } from './CategoryTable'
import { buildCategoryRows, donutSegments } from './categoryReport'
import {
  isPeriodTooLong,
  toCategoryReportParams,
  type ReportFilters,
  type ReportFiltersPatch,
  type ReportKind,
} from './reportFilters'
import {
  compareTotals,
  comparisonPeriod,
  comparisonText,
  periodLabel,
  periodLead,
} from './reportPeriod'
import {
  MissingRatesNotice,
  NoOperationsState,
  ReportError,
  ReportFrame,
  TooLongState,
} from './reportParts'
import { failedQueries, useShownFilters } from './reportQuery'
import { ReportSkeleton } from './ReportSkeleton'
import classes from './ReportsPage.module.css'

const KINDS: ReportKind[] = ['expense', 'income']

/**
 * Вкладка «По категориям» (requirements 5.10): сначала вывод текстом — сколько потрачено
 * (получено) и сравнение с прошлым периодом, — потом кольцо и таблица с подкатегориями.
 * Касание категории ведёт в ленту с этим фильтром.
 */
export function CategoryReportTab({
  filters,
  onChange,
  today,
  filtered,
  onResetFilters,
}: {
  filters: ReportFilters
  onChange: (patch: ReportFiltersPatch) => void
  today: string
  /** Заданы счета или участник: пустой отчёт объясняется ими и снимается «Сбросить фильтры». */
  filtered: boolean
  onResetFilters: () => void
}) {
  const t = useT()
  const tooLong = isPeriodTooLong(filters)
  const params = toCategoryReportParams(filters)
  const previous = comparisonPeriod(filters, today)

  const report = useGetCategoryReport(params, {
    // Пока грузится отчёт с новыми фильтрами, на экране остаётся прежний — без мигания.
    query: { enabled: !tooLong, placeholderData: keepPreviousData },
  })
  // Сравнение — тем же отчётом за предыдущий период. Его ошибка отчёт не ломает: вывод
  // просто без сравнения.
  const previousReport = useGetCategoryReport(
    { ...params, from: previous?.from ?? params.from, to: previous?.to ?? params.to },
    { query: { enabled: !tooLong && previous !== null } },
  )
  const categoriesQuery = useListCategories()

  // Пока грузится отчёт с новыми фильтрами, на экране — прежний, с фильтрами, по которым
  // он получен: «получено» при суммах расходов и ссылки строк с новым видом и старой
  // категорией вели бы в пустую ленту.
  const { stale, shownFilters } = useShownFilters(report, JSON.stringify(params), filters)

  // Сравнение — только когда и отчёт, и сравнительный ответ получены для текущих фильтров.
  // Пока ждём — строка сравнения занимает своё место (иначе кольцо и таблица сдвигались бы).
  let comparison: Comparison = null
  if (previous !== null) {
    if (stale || previousReport.isPending) {
      comparison = 'pending'
    } else if (previousReport.data && report.data) {
      const change = compareTotals(report.data.total, previousReport.data.total)
      comparison = change && comparisonText(change, previous, today, t)
    }
  }

  const isPending = !tooLong && (report.isPending || categoriesQuery.isPending)
  const showSkeleton = useDelayedLoading(isPending)
  const failed = failedQueries([report, categoriesQuery])

  let content
  if (tooLong) {
    content = <TooLongState />
  } else if (failed.length > 0) {
    content = <ReportError failed={failed} />
  } else if (isPending || !report.data) {
    content = showSkeleton ? <ReportSkeleton /> : null
  } else {
    content = (
      <ReportBody
        report={report.data}
        comparison={comparison}
        filters={shownFilters}
        stale={stale}
        today={today}
        categories={categoriesQuery.data?.items ?? []}
        empty={
          <NoOperationsState
            icon={IconChartPie}
            title={t.reports.empty[shownFilters.kind]}
            filtered={filtered}
            onResetFilters={onResetFilters}
          />
        }
      />
    )
  }

  return (
    <div className={classes.stack}>
      <KindSwitch value={filters.kind} onChange={(kind) => onChange({ kind })} />
      <div aria-busy={stale || undefined}>{content}</div>
    </div>
  )
}

/**
 * «Расходы / Доходы» — группа радиокнопок в виде сегментов, как переключатель вида
 * в форме операции (те же стили: не рвёт слова при крупном шрифте).
 */
function KindSwitch({
  value,
  onChange,
}: {
  value: ReportKind
  onChange: (kind: ReportKind) => void
}) {
  const t = useT()
  const name = useId()
  return (
    <div role="radiogroup" aria-label={t.reports.kind.label} className={kindClasses.root}>
      {KINDS.map((kind) => (
        <label key={kind} className={kindClasses.item} data-active={kind === value || undefined}>
          <input
            type="radio"
            name={name}
            value={kind}
            checked={kind === value}
            onChange={() => onChange(kind)}
            className={kindClasses.input}
          />
          {t.reports.kind[kind]}
        </label>
      ))}
    </div>
  )
}

/** Строка сравнения: текст, «ждём» (место занято) или её нет. */
type Comparison = string | 'pending' | null

function ReportBody({
  report,
  comparison,
  filters,
  stale,
  today,
  categories,
  empty,
}: {
  report: CategoryReport
  comparison: Comparison
  /** Фильтры, по которым получен `report` (во время загрузки новых — прежние). */
  filters: ReportFilters
  /** Показан прежний отчёт, пока грузится новый: блок приглушён и не реагирует на действия. */
  stale: boolean
  today: string
  categories: Parameters<typeof buildCategoryRows>[1]
  empty: ReactNode
}) {
  const t = useT()
  const headingId = useId()
  const rows = useMemo(
    () => buildCategoryRows(report.items, categories),
    [report.items, categories],
  )
  const segments = useMemo(() => donutSegments(rows), [rows])
  // Подсвеченная категория: наведение на сегмент подсвечивает строку таблицы.
  const [active, setActive] = useState<string | null>(null)

  const notice = <MissingRatesNotice codes={report.missingRates} />

  if (rows.length === 0) {
    return (
      <ReportFrame stale={stale}>
        {notice}
        {empty}
      </ReportFrame>
    )
  }

  return (
    <ReportFrame stale={stale}>
      {notice}
      <section aria-labelledby={headingId} className={classes.report}>
        <div className={classes.headline}>
          {/* Главная мысль экрана — крупно (ux.md, раздел 1). */}
          <Title order={2} size="xl" id={headingId} className={classes.headlineText}>
            {periodLead(filters, today, t)}{' '}
            {filters.kind === 'expense' ? t.reports.headline.spent : t.reports.headline.received}{' '}
            <Money amount={report.total} currency={report.currency} roundToMajor wrap />
          </Title>
          {comparison === 'pending' ? (
            <Text c="dimmed" aria-hidden>
              {' '}
            </Text>
          ) : (
            comparison !== null && <Text c="dimmed">{comparison}</Text>
          )}
        </div>
        <div className={classes.reportBody}>
          <CategoryDonut
            segments={segments}
            total={report.total}
            currency={report.currency}
            filters={filters}
            active={active}
            onActiveChange={setActive}
          />
          <CategoryTable
            rows={rows}
            total={report.total}
            currency={report.currency}
            filters={filters}
            caption={t.reports.table.caption(
              t.reports.kind[filters.kind],
              periodLabel(filters, today, t),
            )}
            highlighted={active}
          />
        </div>
      </section>
    </ReportFrame>
  )
}
