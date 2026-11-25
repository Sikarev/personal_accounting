import { LOCALE, type Messages } from '../../shared/i18n'
import { formatPeriod } from '../../shared/lib/date'
import { detectPreset, presetPeriod } from '../../shared/lib/transactionFilters'

// Период отчёта словами и сравнение с предыдущим периодом (ux.md, «Отчёты»: «В ноябре
// потрачено 84 300 ₽ — на 12 % меньше, чем в октябре»).

export type ReportPeriod = { from: string; to: string }

const parts = (date: string) => date.split('-').map(Number) as [number, number, number]
const pad = (n: number) => String(n).padStart(2, '0')
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** Каким целым куском календаря является период: месяц, год или произвольный отрезок. */
export type PeriodShape =
  | { type: 'month'; year: number; month: number }
  | { type: 'year'; year: number }
  | { type: 'range' }

export function periodShape({ from, to }: ReportPeriod): PeriodShape {
  const [fy, fm, fd] = parts(from)
  const [ty, tm, td] = parts(to)
  if (fd === 1 && fy === ty && fm === tm && td === lastDay(ty, tm)) {
    return { type: 'month', year: fy, month: fm }
  }
  if (fy === ty && fm === 1 && fd === 1 && tm === 12 && td === 31) return { type: 'year', year: fy }
  return { type: 'range' }
}

/** «ноябре», «ноябре 2025 года» — месяц для «в …»; год — только если он не текущий. */
function monthIn(year: number, month: number, today: string, t: Messages): string {
  const name = t.dates.monthsIn[month - 1]
  return year === parts(today)[0] ? name : t.reports.headline.withYear(name, year)
}

/** Начало вывода: «В ноябре», «В 2026 году», «За 12 месяцев», «За 1–15 ноября». */
export function periodLead(period: ReportPeriod, today: string, t: Messages): string {
  if (detectPreset(period, today, ['last12Months']) === 'last12Months') {
    return t.reports.headline.last12Months
  }
  const shape = periodShape(period)
  if (shape.type === 'month')
    return t.reports.headline.inMonth(monthIn(shape.year, shape.month, today, t))
  if (shape.type === 'year') return t.reports.headline.inYear(shape.year)
  return t.reports.headline.inRange(formatPeriod(period.from, period.to, today))
}

/** Подпись периода (подпись таблицы): «Ноябрь 2026», «2026 год», «1–15 ноября». */
export function periodLabel(period: ReportPeriod, today: string, t: Messages): string {
  const shape = periodShape(period)
  if (shape.type === 'month') return `${t.dates.months[shape.month - 1]} ${shape.year}`
  if (shape.type === 'year') return t.reports.headline.year(shape.year)
  return formatPeriod(period.from, period.to, today)
}

/**
 * С чем сравнивать (вторым запросом того же отчёта):
 * - прошлый месяц (завершённый) — весь месяц перед ним;
 * - текущий месяц — те же дни предыдущего месяца, с 1-го по сегодняшнее число (месяц
 *   ещё идёт, сравнивать с целым месяцем нечестно); 31-е — по последний день короткого месяца;
 * - год — тот же отрезок прошлого года: с 1 января по «сегодня» год назад;
 * - свой период — без сравнения: непонятно, с чем сравнивать.
 * `wholeMonth` — предыдущий период целый месяц: «чем в октябре», иначе «чем за 1–24 октября».
 */
export function comparisonPeriod(
  period: ReportPeriod,
  today: string,
): (ReportPeriod & { wholeMonth: boolean }) | null {
  const [year, month, day] = parts(today)
  switch (detectPreset(period, today)) {
    case 'lastMonth':
      return { ...(presetPeriod('lastMonth', period.from) as ReportPeriod), wholeMonth: true }
    case 'thisMonth': {
      const prev = presetPeriod('lastMonth', today) as ReportPeriod
      const [py, pm] = parts(prev.from)
      return {
        from: prev.from,
        to: `${py}-${pad(pm)}-${pad(Math.min(day, lastDay(py, pm)))}`,
        wholeMonth: false,
      }
    }
    case 'thisYear':
      return {
        from: `${year - 1}-01-01`,
        to: `${year - 1}-${pad(month)}-${pad(Math.min(day, lastDay(year - 1, month)))}`,
        wholeMonth: false,
      }
    default:
      return null
  }
}

export type Change = { direction: 'more' | 'less' | 'same'; percent: number }

/**
 * Изменение суммы в процентах от прошлой, округлённое до целого. В прошлом периоде
 * ничего нет — сравнивать не с чем (`null`): «на ∞ % больше» никому не поможет.
 */
export function compareTotals(current: number, previous: number): Change | null {
  if (previous <= 0) return null
  const percent = Math.round((Math.abs(current - previous) * 100) / previous)
  if (percent === 0) return { direction: 'same', percent: 0 }
  return { direction: current > previous ? 'more' : 'less', percent }
}

const percentFormat = new Intl.NumberFormat(LOCALE, { style: 'percent', maximumFractionDigits: 0 })

/** «на 12 % меньше, чем в октябре», «почти столько же, сколько за 1–24 октября». */
export function comparisonText(
  change: Change,
  previous: ReportPeriod & { wholeMonth: boolean },
  today: string,
  t: Messages,
): string {
  const h = t.reports.headline
  const [py, pm] = parts(previous.from)
  const than = previous.wholeMonth
    ? h.thanMonth(monthIn(py, pm, today, t))
    : h.thanRange(formatPeriod(previous.from, previous.to, today))
  if (change.direction === 'same') return h.same(than)
  const percent = percentFormat.format(change.percent / 100)
  return change.direction === 'more' ? h.more(percent, than) : h.less(percent, than)
}

/** Доля в процентах для таблицы: «12 %»; меньше половины процента, но не ноль — «< 1 %». */
export function formatShare(amount: number, total: number, t: Messages): string {
  if (total <= 0) return percentFormat.format(0)
  const share = amount / total
  if (share > 0 && share < 0.005) return t.reports.table.lessThanOnePercent
  return percentFormat.format(share)
}
