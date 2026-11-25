import type { BalancePoint, BalanceStep, MonthlyReportItem } from '../../shared/api'
import type { Messages } from '../../shared/i18n'
import { formatPeriod, shiftDate } from '../../shared/lib/date'
import { formatMoneyParts } from '../../shared/lib/money'
import { monthEnd, type ReportFilters } from './reportFilters'

// Чистая логика вкладок «По месяцам» и «Баланс»: итоги, средний расход, подписи осей
// и точек, изменение баланса. Суммы складываются в BigInt: за 10 лет по месяцам сумма
// легко выходит за 2^53, а `Money` принимает `bigint` без потери точности.

type Period = Pick<ReportFilters, 'from' | 'to'>

const parts = (date: string) => date.split('-').map(Number) as [number, number, number]

/** Деление с округлением «половина от нуля» — как округляет API (docs/api.md, «Пересчёт»). */
function divRound(sum: bigint, count: bigint): bigint {
  const negative = sum < 0n
  const abs = negative ? -sum : sum
  const q = (abs * 2n + count) / (2n * count)
  return negative ? -q : q
}

// ——— По месяцам ———

export type MonthlyTotals = { income: bigint; expense: bigint; difference: bigint }

/** Итоги за период: доходы, расходы и разница (доходы − расходы). */
export function monthlyTotals(items: readonly MonthlyReportItem[]): MonthlyTotals {
  let income = 0n
  let expense = 0n
  for (const item of items) {
    income += BigInt(item.income)
    expense += BigInt(item.expense)
  }
  return { income, expense, difference: income - expense }
}

/** В периоде нет ни доходов, ни расходов — пустое состояние вместо графика из нулей. */
export function isMonthlyEmpty(items: readonly MonthlyReportItem[]): boolean {
  return items.every((item) => item.income === 0 && item.expense === 0)
}

/**
 * Кто больше: доходы или расходы — по показанной (округлённой до рублей) разнице:
 * разница в 30 копеек — «равны», а не «доходы больше расходов на 0 ₽».
 */
export function differenceDirection(
  difference: bigint,
  currency: string,
): 'incomeMore' | 'expenseMore' | 'equal' {
  const { sign } = formatMoneyParts(difference, currency, { roundToMajor: true })
  return sign > 0 ? 'incomeMore' : sign < 0 ? 'expenseMore' : 'equal'
}

/**
 * Средний расход в месяц — только по полным месяцам:
 * - месяц целиком внутри периода (обрезанный своим периодом месяц занизил бы среднее);
 * - месяц уже закончился: последний день раньше «сегодня» (текущий месяц ещё идёт);
 * - не раньше первого месяца, где есть хоть один доход или расход: месяцы до начала учёта
 *   в приложении — не «ноль расходов», а «ещё не вносили» (иначе у нового пользователя
 *   среднее за 12 месяцев было бы вдвое-втрое ниже настоящего). Пустые месяцы после
 *   начала учёта входят: это честный ноль.
 * Полных месяцев нет — `null` (строку не показываем).
 */
export function averageExpense(
  items: readonly MonthlyReportItem[],
  period: Period,
  today: string,
): { amount: bigint; months: number } | null {
  const first = items.findIndex((item) => item.income !== 0 || item.expense !== 0)
  if (first < 0) return null
  let sum = 0n
  let months = 0
  for (const item of items.slice(first)) {
    const end = monthEnd(item.month)
    if (item.month < period.from || end > period.to || end >= today) continue
    sum += BigInt(item.expense)
    months++
  }
  if (months === 0) return null
  return { amount: divRound(sum, BigInt(months)), months }
}

/** «Ноябрь 2026» — месяц в таблице и подсказке графика. */
export function monthLabel(month: string, t: Messages): string {
  const [year, m] = parts(month)
  return `${t.dates.months[m - 1]} ${year}`
}

// ——— Баланс ———

/** Понедельник ISO-недели, в которую попадает дата. */
function weekStart(date: string): string {
  const [y, m, d] = parts(date)
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 // пн = 0
  return shiftDate(date, -weekday)
}

/**
 * Какие дни покрывает точка баланса. Точка — последний день шага, обрезанный по `to`
 * (docs/api.md, «Баланс»); начало — начало шага, но не раньше `from` отчёта.
 */
export function stepRange(date: string, step: BalanceStep, period: Period): Period {
  const start = step === 'day' ? date : step === 'week' ? weekStart(date) : `${date.slice(0, 8)}01`
  return { from: start > period.from ? start : period.from, to: date }
}

/**
 * Подпись точки в подсказке графика: шаг день — «24 ноября», неделя — «Неделя 18–24
 * ноября», месяц — «Ноябрь 2026» (неполный месяц на краю периода — его дни: «1–15 ноября»).
 */
export function pointLabel(
  date: string,
  step: BalanceStep,
  period: Period,
  today: string,
  t: Messages,
): string {
  const range = stepRange(date, step, period)
  // Шаг день — и неделя или месяц, обрезанные периодом до одного дня («Неделя 30 ноября»
  // звучало бы странно): просто дата.
  if (step === 'day' || range.from === range.to) return formatPeriod(date, date, today)
  if (step === 'week') return t.reports.balance.week(formatPeriod(range.from, range.to, today))
  if (range.from.endsWith('-01') && range.to === monthEnd(range.from)) {
    return monthLabel(range.from, t)
  }
  return formatPeriod(range.from, range.to, today)
}

export type BalanceChange = {
  /** Модуль изменения: последняя точка минус остаток на начало периода. */
  amount: bigint
  direction: 'grew' | 'fell' | 'same'
}

/**
 * Изменение баланса за период: остаток в последней точке минус остаток на начало периода
 * (конец дня перед `from` — отдельный запрос из одной точки). Первая точка ряда для этого
 * не годится: это уже конец первого шага, и «12 месяцев» теряли бы весь первый месяц.
 * Направление — по показанной (округлённой до рублей) разнице. Точек нет — `null`.
 */
export function balanceChange(
  start: number,
  items: readonly BalancePoint[],
  currency: string,
): BalanceChange | null {
  const last = items[items.length - 1]
  if (!last) return null
  const amount = BigInt(last.balance) - BigInt(start)
  const { sign } = formatMoneyParts(amount, currency, { roundToMajor: true })
  return {
    amount: amount < 0n ? -amount : amount,
    direction: sign > 0 ? 'grew' : sign < 0 ? 'fell' : 'same',
  }
}

/**
 * Период запроса баланса: конец — не позже «сегодня». Остаток в будущем — ровная линия
 * из сегодняшнего остатка (или операций с будущей датой), а заголовок «На 30 ноября»
 * 25-го числа вводил бы в заблуждение. Весь период в будущем — `null` (показать нечего).
 * Адрес и фильтры не меняются: обрезается только запрос.
 */
export function balancePeriod<P extends Period>(filters: P, today: string): P | null {
  if (filters.from > today) return null
  return filters.to > today ? { ...filters, to: today } : filters
}

/** День перед началом периода: остаток на его конец — остаток на начало периода. */
export function balanceStartDate(period: Period): string {
  return shiftDate(period.from, -1)
}

// ——— Подписи осей ———

export type AxisTick = {
  /** Значение категории на оси (месяц или дата точки). */
  value: string
  /** «ноя» или «24 ноя». */
  label: string
  /** Год второй строкой: у первой подписи и там, где он сменился. */
  year: string | null
}

// Шаги прореживания подписей: месяцы — по календарю (каждый 2-й, 3-й… месяц от января,
// дальше — январи раз в 1, 2, 3… года), дни и недели — каждая k-я точка от последней.
const MONTH_STEPS = [1, 2, 3, 4, 6, 12, 24, 36, 60, 120]
const DAY_STEPS = [1, 2, 3, 5, 7, 10, 14, 28]

/**
 * Какие подписи показать на оси и какими. Выбор свой, а не recharts: тот прореживает
 * подписи по ширине текста, измеренной в DOM, — интервалы выходят неровными, январь
 * с годом пропадает, а подпись сдвигается на пиксель-другой в зависимости от загрузки
 * шрифта. Здесь — не больше `maxTicks` подписей с ровным шагом:
 * - месяцы (`kind: 'month'`) — по календарю: январь попадает всегда, год виден;
 * - дни и недели (`kind: 'day'`) — каждая k-я точка, считая от последней (она — конец
 *   периода, самая важная).
 * Год — у первой подписи и у каждой, где он сменился (в т. ч. дни через Новый год).
 */
export function axisTicks(
  values: readonly string[],
  kind: 'month' | 'day',
  maxTicks: number,
  t: Messages,
): AxisTick[] {
  const max = Math.max(1, Math.floor(maxTicks))
  const n = values.length
  let chosen: string[] = []
  if (kind === 'month') {
    for (const k of MONTH_STEPS) {
      chosen = values.filter((value) => {
        const [y, m] = parts(value)
        return k < 12 ? (m - 1) % k === 0 : m === 1 && y % (k / 12) === 0
      })
      if (chosen.length > 0 && chosen.length <= max) break
    }
  } else {
    for (const k of DAY_STEPS) {
      chosen = values.filter((_, i) => (n - 1 - i) % k === 0)
      if (chosen.length <= max) break
    }
  }
  if (chosen.length === 0 || chosen.length > max) chosen = values.slice(-1)

  let lastYear: number | null = null
  return chosen.map((value) => {
    const [y, m, d] = parts(value)
    const month = t.dates.monthsShort[m - 1]
    const year = y !== lastYear ? String(y) : null
    lastYear = y
    return { value, label: kind === 'month' ? month : `${d} ${month}`, year }
  })
}

/**
 * Нижняя граница оси значений: ноль, если все значения неотрицательны (столбцы растут
 * от нуля), иначе — минимум данных (разница или остаток ниже нуля видны целиком).
 */
export function axisMin(values: readonly number[]): number {
  return Math.min(0, ...values)
}

/** Есть значения по обе стороны нуля — на графике нужна линия нуля. */
export function crossesZero(values: readonly number[]): boolean {
  return values.some((v) => v < 0) && values.some((v) => v > 0)
}

// ——— Таблицы ———

/** Сколько строк длинной таблицы видно до «Показать все». */
export const COLLAPSED_ROWS = 12

/**
 * Строки таблицы: новые сверху (как в ленте). Длинная таблица (10 лет по месяцам —
 * 121 строка) свёрнута до последних `COLLAPSED_ROWS`, полная — по кнопке.
 */
export function tableRows<T>(items: readonly T[], expanded: boolean): T[] {
  const newestFirst = [...items].reverse()
  return expanded ? newestFirst : newestFirst.slice(0, COLLAPSED_ROWS)
}
