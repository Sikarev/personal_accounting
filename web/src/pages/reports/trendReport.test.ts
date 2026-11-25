import { describe, expect, it } from 'vitest'

import { ru as t } from '../../shared/i18n/ru'
import {
  averageExpense,
  axisMin,
  axisTicks,
  balanceChange,
  balancePeriod,
  balanceStartDate,
  COLLAPSED_ROWS,
  crossesZero,
  differenceDirection,
  isMonthlyEmpty,
  monthlyTotals,
  monthLabel,
  pointLabel,
  stepRange,
  tableRows,
} from './trendReport'

const TODAY = '2026-11-25'
const LAST_12 = { from: '2025-12-01', to: '2026-11-30' }

/** 12 месяцев с декабря 2025: расходы и доходы по порядку. */
function months(expense: number[], income: number[] = expense.map(() => 0)) {
  return expense.map((e, i) => {
    const index = 2025 * 12 + 11 + i
    const month = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`
    return { month, expense: e, income: income[i] }
  })
}

describe('monthlyTotals', () => {
  it('суммы и разница (доходы − расходы)', () => {
    expect(monthlyTotals(months([100, 200], [500, 0]))).toEqual({
      income: 500n,
      expense: 300n,
      difference: 200n,
    })
  })

  it('без потери точности за пределами 2^53', () => {
    const huge = 999_999_999_999_999
    const totals = monthlyTotals(months([huge, huge, huge]))
    expect(totals.expense).toBe(2_999_999_999_999_997n)
    expect(totals.difference).toBe(-2_999_999_999_999_997n)
  })

  it('пустой период', () => {
    expect(isMonthlyEmpty(months([0, 0], [0, 0]))).toBe(true)
    expect(isMonthlyEmpty(months([0, 1]))).toBe(false)
    expect(isMonthlyEmpty([])).toBe(true)
  })
})

describe('differenceDirection', () => {
  it('по рублям, а не копейкам', () => {
    expect(differenceDirection(12_000_000n, 'RUB')).toBe('incomeMore')
    expect(differenceDirection(-50n, 'RUB')).toBe('expenseMore')
    expect(differenceDirection(49n, 'RUB')).toBe('equal')
    expect(differenceDirection(-49n, 'RUB')).toBe('equal')
    expect(differenceDirection(0n, 'RUB')).toBe('equal')
  })
})

describe('averageExpense', () => {
  it('текущий месяц не входит: он ещё идёт', () => {
    // 11 полных месяцев по 100 и ноябрь (текущий) — 1000.
    const items = months([...Array(11).fill(100), 1000])
    expect(averageExpense(items, LAST_12, TODAY)).toEqual({ amount: 100n, months: 11 })
  })

  it('месяцы до первой операции не считаются, пустые после — считаются', () => {
    // Учёт начат в июне: дек–май пусто; июль без операций — честный ноль.
    const items = months([0, 0, 0, 0, 0, 0, 300, 0, 300, 300, 300, 999])
    expect(averageExpense(items, LAST_12, TODAY)).toEqual({ amount: 240n, months: 5 })
  })

  it('первый месяц с одним доходом — тоже начало учёта', () => {
    const items = months(
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 0, 0],
    )
    expect(averageExpense(items, LAST_12, TODAY)).toEqual({ amount: 50n, months: 2 })
  })

  it('обрезанные периодом месяцы не входят', () => {
    const items = months([100, 200, 300])
    expect(averageExpense(items, { from: '2025-12-15', to: '2026-02-10' }, TODAY)).toEqual({
      amount: 200n,
      months: 1,
    })
  })

  it('месяц, который кончается сегодня, ещё не полный', () => {
    const items = months([100, 200])
    expect(averageExpense(items, { from: '2025-12-01', to: '2026-01-31' }, '2026-01-31')).toEqual({
      amount: 100n,
      months: 1,
    })
    expect(averageExpense(items, { from: '2025-12-01', to: '2026-01-31' }, '2026-02-01')).toEqual({
      amount: 150n,
      months: 2,
    })
  })

  it('полных месяцев нет или нет операций — null', () => {
    expect(averageExpense(months([500]), { from: '2026-11-01', to: '2026-11-30' }, TODAY)).toBe(
      null,
    )
    expect(averageExpense(months([0, 0, 0]), LAST_12, TODAY)).toBe(null)
  })

  it('округление — половина от нуля, в целых числах', () => {
    // (1 + 2) / 2 = 1,5 → 2; 10^15 + 1 и 10^15: среднее без float.
    expect(averageExpense(months([1, 2, 9]), LAST_12, '2026-03-01')?.amount).toBe(4n)
    expect(
      averageExpense(months([1, 2, 0]), { from: '2025-12-01', to: '2026-01-31' }, TODAY)?.amount,
    ).toBe(2n)
    const huge = 999_999_999_999_999
    expect(
      averageExpense(months([huge, huge - 1]), { from: '2025-12-01', to: '2026-01-31' }, TODAY)
        ?.amount,
    ).toBe(999_999_999_999_999n)
  })
})

describe('подписи месяцев', () => {
  it('таблица и подсказка — «Ноябрь 2026»', () => {
    expect(monthLabel('2026-11-01', t)).toBe('Ноябрь 2026')
  })
})

describe('баланс: точки и подписи', () => {
  const period = { from: '2026-06-03', to: '2026-11-25' }

  it('диапазон точки по шагу, не раньше начала периода', () => {
    expect(stepRange('2026-11-24', 'day', period)).toEqual({ from: '2026-11-24', to: '2026-11-24' })
    // 2026-06-07 — воскресенье; неделя началась 1 июня, но период — с 3-го.
    expect(stepRange('2026-06-07', 'week', period)).toEqual({
      from: '2026-06-03',
      to: '2026-06-07',
    })
    expect(stepRange('2026-11-22', 'week', period)).toEqual({
      from: '2026-11-16',
      to: '2026-11-22',
    })
    // Последняя точка — `to`, среда: неделя с понедельника по неё.
    expect(stepRange('2026-11-25', 'week', period)).toEqual({
      from: '2026-11-23',
      to: '2026-11-25',
    })
    expect(stepRange('2026-10-31', 'month', period)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    })
    expect(stepRange('2026-06-30', 'month', period)).toEqual({
      from: '2026-06-03',
      to: '2026-06-30',
    })
  })

  it('неделя через Новый год', () => {
    // 2027-01-03 — воскресенье, понедельник той недели — 28 декабря 2026.
    expect(stepRange('2027-01-03', 'week', { from: '2026-12-01', to: '2027-01-31' })).toEqual({
      from: '2026-12-28',
      to: '2027-01-03',
    })
  })

  it('подсказка по шагу', () => {
    expect(pointLabel('2026-11-24', 'day', period, TODAY, t)).toBe('24 ноября')
    expect(pointLabel('2025-11-24', 'day', period, TODAY, t)).toBe('24 ноября 2025')
    expect(pointLabel('2026-11-22', 'week', period, TODAY, t)).toBe('Неделя 16–22 ноября')
    expect(pointLabel('2026-10-31', 'month', period, TODAY, t)).toBe('Октябрь 2026')
    expect(pointLabel('2026-06-30', 'month', period, TODAY, t)).toBe('3–30 июня')
    expect(pointLabel('2026-11-25', 'month', period, TODAY, t)).toBe('1–25 ноября')
    // Неделя, обрезанная периодом до одного дня (`to` — понедельник).
    expect(
      pointLabel('2026-11-30', 'week', { from: '2026-06-01', to: '2026-11-30' }, TODAY, t),
    ).toBe('30 ноября')
  })
})

describe('balanceChange', () => {
  const point = (date: string, balance: number) => ({ date, balance })

  it('последняя точка минус остаток на начало периода', () => {
    expect(balanceChange(46_430_000, [point('2026-11-30', 51_230_000)], 'RUB')).toEqual({
      amount: 4_800_000n,
      direction: 'grew',
    })
    expect(
      balanceChange(100_000, [point('2026-10-31', 0), point('2026-11-30', -50_000)], 'RUB'),
    ).toEqual({ amount: 150_000n, direction: 'fell' })
  })

  it('меньше рубля — не изменился; точек нет — null', () => {
    expect(balanceChange(100, [point('2026-11-02', 140)], 'RUB')).toEqual({
      amount: 40n,
      direction: 'same',
    })
    expect(balanceChange(100, [], 'RUB')).toBe(null)
  })
})

describe('период запроса баланса', () => {
  const filters = { from: '2026-11-01', to: '2026-11-30', accountId: ['a'] }

  it('конец — не позже сегодня, остальное не трогается', () => {
    expect(balancePeriod(filters, '2026-11-25')).toEqual({ ...filters, to: '2026-11-25' })
    expect(balancePeriod(filters, '2026-12-01')).toBe(filters)
    expect(balancePeriod(filters, '2026-11-01')).toEqual({ ...filters, to: '2026-11-01' })
  })

  it('весь период в будущем — null', () => {
    expect(balancePeriod(filters, '2026-10-31')).toBe(null)
  })

  it('остаток на начало — конец предыдущего дня', () => {
    expect(balanceStartDate({ from: '2026-01-01', to: '2026-01-31' })).toBe('2025-12-31')
    expect(balanceStartDate({ from: '2028-03-01', to: '2028-03-31' })).toBe('2028-02-29')
  })
})

describe('axisTicks', () => {
  const monthsFrom = (start: string, count: number, day = '01') => {
    const [y, m] = start.split('-').map(Number)
    return Array.from({ length: count }, (_, i) => {
      const index = y * 12 + m - 1 + i
      return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-${day}`
    })
  }
  const days = (from: string, count: number) =>
    Array.from({ length: count }, (_, i) =>
      new Date(Date.parse(from) + i * 86_400_000).toISOString().slice(0, 10),
    )
  const show = (ticks: ReturnType<typeof axisTicks>) =>
    ticks.map((tick) => (tick.year ? `${tick.label} ${tick.year}` : tick.label))

  it('месяцы: помещаются — все, год у первого и у января', () => {
    expect(show(axisTicks(monthsFrom('2025-12', 12), 'month', 12, t))).toEqual([
      'дек 2025',
      'янв 2026',
      'фев',
      'мар',
      'апр',
      'май',
      'июн',
      'июл',
      'авг',
      'сен',
      'окт',
      'ноя',
    ])
  })

  it('месяцы: прореживание по календарю — январь всегда виден', () => {
    expect(show(axisTicks(monthsFrom('2025-12', 12), 'month', 7, t))).toEqual([
      'янв 2026',
      'мар',
      'май',
      'июл',
      'сен',
      'ноя',
    ])
    expect(show(axisTicks(monthsFrom('2025-12', 12), 'month', 4, t))).toEqual([
      'янв 2026',
      'апр',
      'июл',
      'окт',
    ])
  })

  it('10 лет — январи, при нехватке места через год; у каждой подписи свой год', () => {
    const values = monthsFrom('2016-12', 120, '28')
    expect(show(axisTicks(values, 'month', 10, t))).toEqual(
      [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => `янв ${y}`),
    )
    expect(show(axisTicks(values, 'month', 5, t))).toEqual(
      [2018, 2020, 2022, 2024, 2026].map((y) => `янв ${y}`),
    )
  })

  it('дни: каждая k-я от последней, год — где сменился', () => {
    const values = days('2026-11-01', 30)
    const ticks = axisTicks(values, 'day', 6, t)
    expect(ticks.at(-1)?.value).toBe('2026-11-30')
    expect(show(ticks)).toEqual(['5 ноя 2026', '10 ноя', '15 ноя', '20 ноя', '25 ноя', '30 ноя'])
    // Через Новый год.
    expect(show(axisTicks(days('2026-12-25', 14), 'day', 4, t))).toEqual([
      '28 дек 2026',
      '2 янв 2027',
      '7 янв',
    ])
  })

  it('всё помещается — все точки; места на одну — одна подпись', () => {
    expect(axisTicks(days('2026-11-01', 3), 'day', 10, t)).toHaveLength(3)
    expect(show(axisTicks(days('2026-11-01', 3), 'day', 0, t))).toEqual(['3 ноя 2026'])
    expect(show(axisTicks(monthsFrom('2026-02', 3), 'month', 0, t))).toEqual(['мар 2026'])
  })
})

describe('ось значений', () => {
  it('ноль внизу, пока нет отрицательных', () => {
    expect(axisMin([5, 10])).toBe(0)
    expect(axisMin([5, -10])).toBe(-10)
    expect(crossesZero([5, -10])).toBe(true)
    expect(crossesZero([5, 0])).toBe(false)
    expect(crossesZero([-5, -1])).toBe(false)
  })
})

describe('tableRows', () => {
  it('новые сверху; длинная таблица свёрнута', () => {
    const items = Array.from({ length: 30 }, (_, i) => i)
    expect(tableRows(items, false)).toHaveLength(COLLAPSED_ROWS)
    expect(tableRows(items, false)[0]).toBe(29)
    expect(tableRows(items, true)).toHaveLength(30)
    expect(tableRows([1, 2, 3], false)).toEqual([3, 2, 1])
  })
})
