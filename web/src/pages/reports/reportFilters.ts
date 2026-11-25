import type { CategoryKind, GetCategoryReportParams } from '../../shared/api'
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
// это «Этот месяц»; вид — один, расходы или доходы (`kind=income`, без параметра — расходы).

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
  'thisYear',
  'custom',
] as const satisfies readonly PeriodPreset[]

/** Период по умолчанию — текущий месяц (requirements 5.10). */
export const DEFAULT_REPORT_PRESET = 'thisMonth' satisfies PeriodPreset

/** Фильтры из адреса. Нет периода (или только одна граница) — текущий месяц. */
export function parseReportFilters(params: URLSearchParams, today: string): ReportFilters {
  const feed = parseFilters(params)
  let period = presetPeriod(DEFAULT_REPORT_PRESET, today) as { from: string; to: string }
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

/** Фильтры → адрес. Значения по умолчанию (текущий месяц, расходы) в адрес не попадают. */
export function reportFiltersToSearchParams(
  filters: ReportFilters,
  today: string,
): URLSearchParams {
  const isDefault = detectPreset(filters, today) === DEFAULT_REPORT_PRESET
  return filtersToSearchParams({
    ...EMPTY_FILTERS,
    from: isDefault ? null : filters.from,
    to: isDefault ? null : filters.to,
    kind: filters.kind === 'income' ? ['income'] : [],
    accountId: filters.accountId,
    authorId: filters.authorId,
  })
}

/** Применить изменение к фильтрам (`null` у границы — период по умолчанию). */
export function applyPatch(
  filters: ReportFilters,
  patch: ReportFiltersPatch,
  today: string,
): ReportFilters {
  const next = { ...filters }
  if (patch.kind !== undefined) next.kind = patch.kind
  if (patch.accountId !== undefined) next.accountId = patch.accountId
  if (patch.authorId !== undefined) next.authorId = patch.authorId
  if (patch.from === null || patch.to === null) {
    Object.assign(next, presetPeriod(DEFAULT_REPORT_PRESET, today))
  } else {
    if (patch.from !== undefined) next.from = patch.from
    if (patch.to !== undefined) next.to = patch.to
  }
  return next
}

/** Последний день месяца: нулевой день следующего. */
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/**
 * Дата на `years` лет позже; 29 февраля в невисокосном году — 28-е (как `date + interval`
 * в Postgres, которым API проверяет длину периода).
 */
export function addYears(date: string, years: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const year = y + years
  const day = Math.min(d, lastDay(year, m))
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
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

/**
 * Активные фильтры чипами: период (если не текущий месяц), счета, автор. Вид (расходы или
 * доходы) — не чип: его видно по переключателю.
 */
export function reportFilterChips(
  filters: ReportFilters,
  lookups: { accountNames: ReadonlyMap<string, string>; today: string; meId?: string },
  t: Messages,
): FilterChip<ReportFiltersPatch>[] {
  const chips: FilterChip<ReportFiltersPatch>[] = []
  const preset = detectPreset(filters, lookups.today)
  if (preset !== DEFAULT_REPORT_PRESET) {
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
