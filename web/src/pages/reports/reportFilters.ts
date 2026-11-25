import type {
  CategoryKind,
  GetBalanceReportParams,
  GetCategoryReportParams,
  GetMonthlyReportParams,
} from '../../shared/api'
import type { Messages } from '../../shared/i18n'
import { paths } from '../../app/navigation'
import { formatPeriod } from '../../shared/lib/date'
import {
  detectPreset,
  EMPTY_FILTERS,
  filtersToSearchParams,
  parseFilters,
  presetPeriod,
  type PeriodPreset,
} from '../../shared/lib/transactionFilters'
import type { FilterChip } from '../../shared/ui'

// Фильтры отчётов живут в адресе, как фильтры ленты (`/reports/categories?from=…`), и
// разбираются тем же кодом (`parseFilters`): имена параметров и формат совпадают, поэтому
// фильтры переносятся между вкладками и в ленту без перевода.
//
// Отличия от ленты: период есть всегда (API требует `from` и `to`) — без него в адресе
// это период вкладки по умолчанию («Этот месяц» у категорий, «12 месяцев» у трендов);
// вид — один, расходы или доходы (`kind=income`, без параметра — расходы).
//
// Умолчание в адрес не пишется: переход на другую вкладку без явного периода даёт ей
// её собственное умолчание, а явно выбранный период (он в адресе) переносится.

export type ReportKind = CategoryKind

export type ReportFilters = {
  from: string
  to: string
  kind: ReportKind
  accountId: string[]
  authorId: string[]
}

/** Изменение фильтров; `from`/`to` = `null` — период по умолчанию. */
export type ReportFiltersPatch = Partial<{
  from: string | null
  to: string | null
  kind: ReportKind
  accountId: string[]
  authorId: string[]
}>

/** Готовые периоды отчётов: «Всего времени» нет — API ограничивает период 10 годами. */
export const REPORT_PRESETS = [
  'thisMonth',
  'lastMonth',
  'last12Months',
  'thisYear',
  'custom',
] as const satisfies readonly PeriodPreset[]

/** Готовый период, который может быть умолчанием вкладки. */
export type ReportDefaultPreset = 'thisMonth' | 'last12Months'

/**
 * Период по умолчанию (requirements 5.10): по категориям — текущий месяц, по месяцам
 * и баланс — 12 месяцев («по умолчанию 12 месяцев»), иначе тренда не видно.
 */
export const DEFAULT_REPORT_PRESET = 'thisMonth' satisfies ReportDefaultPreset
export const DEFAULT_TREND_PRESET = 'last12Months' satisfies ReportDefaultPreset

const defaultPeriod = (preset: ReportDefaultPreset, today: string) =>
  presetPeriod(preset, today) as { from: string; to: string }

/** Фильтры из адреса. Нет периода (или только одна граница) — период вкладки по умолчанию. */
export function parseReportFilters(
  params: URLSearchParams,
  today: string,
  defaultPreset: ReportDefaultPreset = DEFAULT_REPORT_PRESET,
): ReportFilters {
  const feed = parseFilters(params)
  let period = defaultPeriod(defaultPreset, today)
  if (feed.from && feed.to) {
    // Перепутанные руками границы — меняем местами, как поля периода.
    period =
      feed.from <= feed.to ? { from: feed.from, to: feed.to } : { from: feed.to, to: feed.from }
  }
  return {
    ...period,
    kind: feed.kind[0] === 'income' ? 'income' : 'expense',
    accountId: feed.accountId,
    authorId: feed.authorId,
  }
}

/** Фильтры → адрес. Значения по умолчанию (период вкладки, расходы) в адрес не попадают. */
export function reportFiltersToSearchParams(
  filters: ReportFilters,
  today: string,
  defaultPreset: ReportDefaultPreset = DEFAULT_REPORT_PRESET,
): URLSearchParams {
  const isDefault = detectPreset(filters, today, REPORT_PRESETS) === defaultPreset
  return filtersToSearchParams({
    ...EMPTY_FILTERS,
    from: isDefault ? null : filters.from,
    to: isDefault ? null : filters.to,
    kind: filters.kind === 'income' ? ['income'] : [],
    accountId: filters.accountId,
    authorId: filters.authorId,
  })
}

/** Применить изменение к фильтрам (`null` у границы — период вкладки по умолчанию). */
export function applyPatch(
  filters: ReportFilters,
  patch: ReportFiltersPatch,
  today: string,
  defaultPreset: ReportDefaultPreset = DEFAULT_REPORT_PRESET,
): ReportFilters {
  const next = { ...filters }
  if (patch.kind !== undefined) next.kind = patch.kind
  if (patch.accountId !== undefined) next.accountId = patch.accountId
  if (patch.authorId !== undefined) next.authorId = patch.authorId
  if (patch.from === null || patch.to === null) {
    Object.assign(next, defaultPeriod(defaultPreset, today))
  } else {
    if (patch.from !== undefined) next.from = patch.from
    if (patch.to !== undefined) next.to = patch.to
  }
  return next
}

/**
 * Дата на `years` лет позже — как `time.AddDate(years, 0, 0)` в Go, которым API проверяет
 * длину периода (`internal/httpapi/reports.go`): несуществующая дата переносится вперёд,
 * 29 февраля + 10 лет = 1 марта (а не 28 февраля, как `date + interval` в Postgres).
 */
export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split('-').map(Number)
  // Не `Date.UTC(year, …)`: он переводит годы 0–99 в 1900–1999. Переполнение дня
  // `setUTCFullYear` нормализует так же, как Go.
  const result = new Date(0)
  result.setUTCFullYear(y + years, m - 1, d)
  return result.toISOString().slice(0, 10)
}

/**
 * Период слишком длинный для API: `to` должен быть раньше, чем `from` + 10 лет
 * (docs/api.md → «Отчёты», `period_too_long`). Проверяем заранее и объясняем словами,
 * а не показываем ошибку запроса.
 */
export function isPeriodTooLong({ from, to }: { from: string; to: string }): boolean {
  return to >= addYears(from, 10)
}

/** Параметры `GET /reports/categories` (без пустых массивов). */
export function toCategoryReportParams(filters: ReportFilters): GetCategoryReportParams {
  const params: GetCategoryReportParams = { kind: filters.kind, from: filters.from, to: filters.to }
  if (filters.accountId.length) params.accountId = filters.accountId
  if (filters.authorId.length) params.authorId = filters.authorId
  return params
}

/** Параметры `GET /reports/monthly` (без пустых массивов). */
export function toMonthlyReportParams(filters: ReportFilters): GetMonthlyReportParams {
  const params: GetMonthlyReportParams = { from: filters.from, to: filters.to }
  if (filters.accountId.length) params.accountId = filters.accountId
  if (filters.authorId.length) params.authorId = filters.authorId
  return params
}

/** Параметры `GET /reports/balance`: автора нет — у остатка его нет, API его не принимает. */
export function toBalanceReportParams(filters: ReportFilters): GetBalanceReportParams {
  const params: GetBalanceReportParams = { from: filters.from, to: filters.to }
  if (filters.accountId.length) params.accountId = filters.accountId
  return params
}

/**
 * Ссылка на ленту с операциями категории за период отчёта — с теми же счетами и автором.
 * Адрес собирает `filtersToSearchParams` ленты, поэтому формат совпадает с её разбором.
 * Категория верхнего уровня в ленте включает подкатегории — как строка отчёта.
 */
export function feedLink(filters: ReportFilters, categoryId: string): string {
  const params = filtersToSearchParams({
    ...EMPTY_FILTERS,
    from: filters.from,
    to: filters.to,
    kind: [filters.kind],
    accountId: filters.accountId,
    categoryId: [categoryId],
    authorId: filters.authorId,
  })
  return `${paths.transactions}?${params}`
}

/** Последний день месяца: `2026-02-01` → `2026-02-28` (нулевой день следующего месяца). */
export function monthEnd(month: string): string {
  const [year, m] = month.split('-').map(Number)
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return `${month.slice(0, 8)}${String(day).padStart(2, '0')}`
}

/**
 * Ссылка на ленту с расходами или доходами месяца из отчёта по месяцам: месяц, обрезанный
 * по периоду отчёта (отчёт считает только операции внутри периода — лента покажет те же),
 * с теми же счетами и автором.
 */
export function monthFeedLink(filters: ReportFilters, month: string, kind: ReportKind): string {
  const end = monthEnd(month)
  const params = filtersToSearchParams({
    ...EMPTY_FILTERS,
    from: month > filters.from ? month : filters.from,
    to: end < filters.to ? end : filters.to,
    kind: [kind],
    accountId: filters.accountId,
    authorId: filters.authorId,
  })
  return `${paths.transactions}?${params}`
}

/**
 * Активные фильтры чипами: период (если не умолчание вкладки), счета, автор. Вид (расходы
 * или доходы) — не чип: его видно по переключателю.
 */
export function reportFilterChips(
  filters: ReportFilters,
  lookups: {
    accountNames: ReadonlyMap<string, string>
    today: string
    meId?: string
    defaultPreset?: ReportDefaultPreset
  },
  t: Messages,
): FilterChip<ReportFiltersPatch>[] {
  const chips: FilterChip<ReportFiltersPatch>[] = []
  const preset = detectPreset(filters, lookups.today, REPORT_PRESETS)
  if (preset !== (lookups.defaultPreset ?? DEFAULT_REPORT_PRESET)) {
    chips.push({
      key: 'period',
      label:
        preset === 'custom' || preset === 'all'
          ? formatPeriod(filters.from, filters.to, lookups.today)
          : t.feed.filters.periods[preset],
      without: { from: null, to: null },
    })
  }
  for (const id of filters.accountId) {
    chips.push({
      key: `account:${id}`,
      label: lookups.accountNames.get(id) ?? t.feed.row.unknownAccount,
      without: { accountId: filters.accountId.filter((a) => a !== id) },
    })
  }
  for (const id of filters.authorId) {
    chips.push({
      key: `author:${id}`,
      label: id === lookups.meId ? t.feed.filters.mine : t.feed.filters.otherAuthor,
      without: { authorId: filters.authorId.filter((a) => a !== id) },
    })
  }
  return chips
}
