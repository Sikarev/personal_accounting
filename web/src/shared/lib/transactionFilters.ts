import type { ListTransactionsParams, TransactionKind } from '../api'
import { isCalendarDate } from './date'

// Фильтры ленты операций живут в адресе страницы (`/transactions?from=…&kind=…`): ссылка
// с фильтром открывает отфильтрованную ленту (так на неё будут вести отчёты этапа 4).
// Имена параметров — те же, что у `GET /transactions` (docs/api.md → «Операции»),
// массивы — повторением параметра: `?kind=expense&kind=income`.

export const FILTER_KINDS = [
  'expense',
  'income',
  'transfer',
  'adjustment',
] as const satisfies readonly TransactionKind[]

export type FeedFilters = {
  /** Начало периода `YYYY-MM-DD` (включительно); `null` — без ограничения. */
  from: string | null
  /** Конец периода (включительно). */
  to: string | null
  kind: TransactionKind[]
  accountId: string[]
  categoryId: string[]
  /** Поиск по комментарию — как ввёл пользователь, пробелы обрезаются перед запросом. */
  q: string
}

export const EMPTY_FILTERS: FeedFilters = {
  from: null,
  to: null,
  kind: [],
  accountId: [],
  categoryId: [],
  q: '',
}

// Ограничения контракта: лишнее API отклонило бы 422, и лента показала бы ошибку
// из-за испорченной руками ссылки. Поэтому неподходящие значения просто отбрасываются.
const MAX_IDS = 100
const MAX_QUERY = 200
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isKind = (value: string): value is TransactionKind =>
  (FILTER_KINDS as readonly string[]).includes(value)

/** Уникальные значения в исходном порядке. */
const unique = <T>(values: T[]): T[] => [...new Set(values)]

function dateParam(params: URLSearchParams, name: string): string | null {
  const value = params.get(name)
  return value !== null && isCalendarDate(value) ? value : null
}

/** Фильтры из адреса. Неизвестные, повреждённые и повторяющиеся значения отбрасываются. */
export function parseFilters(params: URLSearchParams): FeedFilters {
  const ids = (name: string) =>
    unique(params.getAll(name).filter((id) => UUID.test(id))).slice(0, MAX_IDS)
  return {
    from: dateParam(params, 'from'),
    to: dateParam(params, 'to'),
    kind: unique(params.getAll('kind').filter(isKind)),
    accountId: ids('accountId'),
    categoryId: ids('categoryId'),
    q: (params.get('q') ?? '').slice(0, MAX_QUERY),
  }
}

/** Фильтры → параметры адреса. Пустые фильтры в адрес не попадают. */
export function filtersToSearchParams(filters: FeedFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  for (const kind of filters.kind) params.append('kind', kind)
  for (const id of filters.accountId) params.append('accountId', id)
  for (const id of filters.categoryId) params.append('categoryId', id)
  if (filters.q !== '') params.set('q', filters.q)
  return params
}

/** Параметры `GET /transactions` и `/transactions/summary` (без пустых). */
export function toListParams(filters: FeedFilters): ListTransactionsParams {
  const params: ListTransactionsParams = {}
  if (filters.from) params.from = filters.from
  if (filters.to) params.to = filters.to
  if (filters.kind.length) params.kind = filters.kind
  if (filters.accountId.length) params.accountId = filters.accountId
  if (filters.categoryId.length) params.categoryId = filters.categoryId
  const q = filters.q.trim()
  if (q) params.q = q
  return params
}

/** Задан ли хоть один фильтр (поиск из одних пробелов не считается). */
export function hasActiveFilters(filters: FeedFilters): boolean {
  return (
    filters.from !== null ||
    filters.to !== null ||
    filters.kind.length > 0 ||
    filters.accountId.length > 0 ||
    filters.categoryId.length > 0 ||
    filters.q.trim() !== ''
  )
}

// ——— Период ———

export type PeriodPreset = 'all' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'custom'

export const PERIOD_PRESETS = [
  'all',
  'thisMonth',
  'lastMonth',
  'thisYear',
  'custom',
] as const satisfies readonly PeriodPreset[]

export type Period = { from: string | null; to: string | null }

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`
/** Последний день месяца: нулевой день следующего месяца. */
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

function monthRange(year: number, month: number): Period {
  return { from: iso(year, month, 1), to: iso(year, month, lastDay(year, month)) }
}

/**
 * Границы готового периода относительно «сегодня» пользователя (`useToday()`): месяц
 * и год — целиком, включая будущие дни (операцию можно внести и на завтра).
 * «Всё время» — без границ; у «Своего периода» границ нет — их задаёт пользователь.
 */
export function presetPeriod(preset: PeriodPreset, today: string): Period {
  const [year, month] = today.split('-').map(Number)
  switch (preset) {
    case 'thisMonth':
      return monthRange(year, month)
    case 'lastMonth':
      return month === 1 ? monthRange(year - 1, 12) : monthRange(year, month - 1)
    case 'thisYear':
      return { from: iso(year, 1, 1), to: iso(year, 12, 31) }
    case 'all':
    case 'custom':
      return { from: null, to: null }
  }
}

/** Какой готовый период совпадает с границами; не совпал ни один — «Свой период». */
export function detectPreset(period: Period, today: string): PeriodPreset {
  if (period.from === null && period.to === null) return 'all'
  for (const preset of ['thisMonth', 'lastMonth', 'thisYear'] as const) {
    const range = presetPeriod(preset, today)
    if (range.from === period.from && range.to === period.to) return preset
  }
  return 'custom'
}
