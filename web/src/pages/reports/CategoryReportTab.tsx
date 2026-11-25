import { Button, Text, Title } from '@mantine/core'
import { IconAlertCircle, IconChartPie, IconInfoCircle, IconPlus } from '@tabler/icons-react'
import { keepPreviousData } from '@tanstack/react-query'
import { useId, useMemo, useState, type ReactNode } from 'react'

import kindClasses from '../../features/transactions/KindSwitch.module.css'
import { useQuickAdd } from '../../features/quick-add/quickAddContext'
import {
  apiErrorText,
  useGetCategoryReport,
  useListCategories,
  type CategoryReport,
} from '../../shared/api'
import { useT } from '../../shared/i18n'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import { EmptyState, Money } from '../../shared/ui'
import { icons } from '../../theme'
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
  const quickAdd = useQuickAdd()
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

  // Пока грузится отчёт с новыми фильтрами, на экране — прежний (placeholder). Рисовать его
  // нужно с теми фильтрами, по которым он получен: иначе заголовок врал бы («получено»
  // при суммах расходов, «в октябре» при суммах за ноябрь), а ссылки строк вели бы с новым
  // видом и старой категорией в пустую ленту. Запоминаем фильтры последнего настоящего ответа.
  const key = JSON.stringify(params)
  const [loaded, setLoaded] = useState<{ key: string; filters: ReportFilters } | null>(null)
  if (report.data && !report.isPlaceholderData && loaded?.key !== key) {
    setLoaded({ key, filters })
  }
  const stale = report.isPlaceholderData
  const shownFilters = stale && loaded ? loaded.filters : filters

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
  // Ошибка — только когда показать нечего: при фоновой ошибке остаются прежние данные.
  // Отчёт с новыми фильтрами не загрузился — прежний (placeholder) на экране не оставляем:
  // он выдавал бы себя за отчёт по новым фильтрам. Счётчик ошибок держит блок ошибки
  // на месте во время «Повторить» (как на главной).
  const failed = [report, categoriesQuery].filter(
    (q) => (!q.data || q.isPlaceholderData) && (q.isError || q.errorUpdateCount > 0),
  )

  let content
  if (tooLong) {
    content = (
      <div className={classes.card}>
        <EmptyState
          icon={IconInfoCircle}
          title={t.reports.tooLong.title}
          description={t.reports.tooLong.description}
        />
      </div>
    )
  } else if (failed.length > 0) {
    content = (
      <div className={classes.card}>
        <EmptyState
          icon={IconAlertCircle}
          title={t.reports.loadError}
          description={apiErrorText(failed[0].error ?? null, t)}
          action={
            <Button
              variant="default"
              size="md"
              className={classes.touchButton}
              loading={failed.some((q) => q.isFetching)}
              onClick={() => failed.forEach((q) => void q.refetch())}
            >
              {t.errors.retry}
            </Button>
          }
        />
      </div>
    )
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
          <div className={classes.card}>
            <EmptyState
              icon={IconChartPie}
              title={t.reports.empty[shownFilters.kind]}
              description={
                filtered ? t.reports.empty.filteredDescription : t.reports.empty.description
              }
              action={
                filtered ? (
                  <Button variant="default" size="md" onClick={onResetFilters}>
                    {t.reports.empty.resetFilters}
                  </Button>
                ) : (
                  <Button
                    variant="light"
                    size="md"
                    leftSection={<IconPlus size={icons.size.md} stroke={icons.stroke} />}
                    onClick={() => quickAdd.open()}
                  >
                    {t.nav.addTransaction}
                  </Button>
                )
              }
            />
          </div>
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

  const notice = report.missingRates.length > 0 && (
    <div className={classes.notice}>
      <IconInfoCircle
        size={icons.size.md}
        stroke={icons.stroke}
        aria-hidden
        className={classes.noticeIcon}
      />
      <Text size="sm">{t.reports.missingRates(report.missingRates)}</Text>
    </div>
  )

  if (rows.length === 0) {
    return (
      <div className={classes.stack} data-stale={stale || undefined} inert={stale}>
        {notice}
        {empty}
      </div>
    )
  }

  return (
    // Устаревший отчёт приглушён и инертен: ссылки и кольцо не ведут по прежним данным,
    // пока на экране не появится отчёт по выбранным фильтрам.
    <div className={classes.stack} data-stale={stale || undefined} inert={stale}>
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
    </div>
  )
}
