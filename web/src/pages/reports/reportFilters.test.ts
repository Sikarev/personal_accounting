import { describe, expect, it } from 'vitest'

import { ru as t } from '../../shared/i18n/ru'
import { parseFilters } from '../../shared/lib/transactionFilters'
import {
  addYears,
  applyPatch,
  feedLink,
  isPeriodTooLong,
  monthEnd,
  monthFeedLink,
  parseReportFilters,
  reportFilterChips,
  reportFiltersToSearchParams,
  toBalanceReportParams,
  toCategoryReportParams,
  toMonthlyReportParams,
  type ReportFilters,
} from './reportFilters'

const TODAY = '2026-11-24'
const A = '01a1faf8-0000-7000-8000-0000000000a1'
const U = '01a1faf8-0000-7000-8000-000000000001'
const C = '01a1faf8-0000-7000-8000-0000000000c1'

const parse = (query: string) => parseReportFilters(new URLSearchParams(query), TODAY)

const NOVEMBER: ReportFilters = {
  from: '2026-11-01',
  to: '2026-11-30',
  kind: 'expense',
  accountId: [],
  authorId: [],
}

describe('parseReportFilters', () => {
  it('пустой адрес — расходы за текущий месяц', () => {
    expect(parse('')).toEqual(NOVEMBER)
  })

  it('все фильтры — тем же разбором, что у ленты', () => {
    expect(parse(`from=2026-01-01&to=2026-12-31&kind=income&accountId=${A}&authorId=${U}`)).toEqual(
      {
        from: '2026-01-01',
        to: '2026-12-31',
        kind: 'income',
        accountId: [A],
        authorId: [U],
      },
    )
  })

  it('одна граница или испорченная дата — текущий месяц; перепутанные — местами', () => {
    expect(parse('from=2026-10-01')).toEqual(NOVEMBER)
    expect(parse('from=2026-10-01&to=2026-02-31')).toEqual(NOVEMBER)
    expect(parse('from=2026-10-31&to=2026-10-01')).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    })
  })

  it('неизвестный вид — расходы', () => {
    expect(parse('kind=transfer').kind).toBe('expense')
  })
})

describe('reportFiltersToSearchParams', () => {
  it('значения по умолчанию в адрес не попадают', () => {
    expect(reportFiltersToSearchParams(NOVEMBER, TODAY).toString()).toBe('')
  })

  it('туда и обратно — те же фильтры', () => {
    const filters: ReportFilters = {
      from: '2026-10-01',
      to: '2026-10-31',
      kind: 'income',
      accountId: [A],
      authorId: [U],
    }
    const params = reportFiltersToSearchParams(filters, TODAY)
    expect(params.toString()).toBe(
      `from=2026-10-01&to=2026-10-31&kind=income&accountId=${A}&authorId=${U}`,
    )
    expect(parseReportFilters(params, TODAY)).toEqual(filters)
  })
})

describe('applyPatch', () => {
  it('сброс периода — текущий месяц', () => {
    const october = { ...NOVEMBER, from: '2026-10-01', to: '2026-10-31' }
    expect(applyPatch(october, { from: null, to: null }, TODAY)).toEqual(NOVEMBER)
  })

  it('одна граница — меняется только она', () => {
    expect(applyPatch(NOVEMBER, { from: '2026-11-10' }, TODAY)).toEqual({
      ...NOVEMBER,
      from: '2026-11-10',
    })
  })
})

describe('длина периода', () => {
  it('addYears — как AddDate в Go: 29 февраля в невисокосном году — 1 марта', () => {
    expect(addYears('2024-02-29', 10)).toBe('2034-03-01')
    expect(addYears('2026-11-24', -1)).toBe('2025-11-24')
  })

  it('10 лет и длиннее — слишком длинный (как period_too_long в API)', () => {
    expect(isPeriodTooLong({ from: '2016-11-25', to: '2026-11-24' })).toBe(false)
    expect(isPeriodTooLong({ from: '2016-11-24', to: '2026-11-24' })).toBe(true)
    // Как в API: от 29.02.2024 граница — 1 марта 2034, 28 февраля ещё можно.
    expect(isPeriodTooLong({ from: '2024-02-29', to: '2034-02-28' })).toBe(false)
    expect(isPeriodTooLong({ from: '2024-02-29', to: '2034-03-01' })).toBe(true)
  })
})

describe('запрос и ссылка в ленту', () => {
  it('параметры отчёта — без пустых массивов', () => {
    expect(toCategoryReportParams(NOVEMBER)).toEqual({
      kind: 'expense',
      from: '2026-11-01',
      to: '2026-11-30',
    })
    expect(toCategoryReportParams({ ...NOVEMBER, accountId: [A], authorId: [U] })).toMatchObject({
      accountId: [A],
      authorId: [U],
    })
  })

  it('ссылка в ленту разбирается лентой в те же фильтры', () => {
    const link = feedLink({ ...NOVEMBER, accountId: [A], authorId: [U] }, C)
    const [path, query] = link.split('?')
    expect(path).toBe('/transactions')
    expect(parseFilters(new URLSearchParams(query))).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      kind: ['expense'],
      accountId: [A],
      categoryId: [C],
      authorId: [U],
      q: '',
    })
  })
})

describe('reportFilterChips', () => {
  const lookups = { accountNames: new Map([[A, 'Карта']]), today: TODAY, meId: U }

  it('текущий месяц без фильтров — чипов нет', () => {
    expect(reportFilterChips(NOVEMBER, lookups, t)).toEqual([])
  })

  it('период, счёт, автор', () => {
    const chips = reportFilterChips(
      { ...NOVEMBER, from: '2026-11-01', to: '2026-11-15', accountId: [A], authorId: [U] },
      lookups,
      t,
    )
    expect(chips.map((c) => [c.label, c.without])).toEqual([
      ['1–15 ноября', { from: null, to: null }],
      ['Карта', { accountId: [] }],
      [t.feed.filters.mine, { authorId: [] }],
    ])
    expect(
      reportFilterChips({ ...NOVEMBER, from: '2026-01-01', to: '2026-12-31' }, lookups, t)[0].label,
    ).toBe(t.feed.filters.periods.thisYear)
  })
})

describe('период вкладки по умолчанию (тренды — 12 месяцев)', () => {
  const LAST_12: ReportFilters = { ...NOVEMBER, from: '2025-12-01', to: '2026-11-30' }
  const trend = 'last12Months' as const

  it('пустой адрес — 12 месяцев, включая текущий', () => {
    expect(parseReportFilters(new URLSearchParams(''), TODAY, trend)).toEqual(LAST_12)
  })

  it('умолчание вкладки в адрес не пишется, умолчание другой вкладки — пишется', () => {
    expect(reportFiltersToSearchParams(LAST_12, TODAY, trend).toString()).toBe('')
    expect(reportFiltersToSearchParams(NOVEMBER, TODAY, trend).toString()).toBe(
      'from=2026-11-01&to=2026-11-30',
    )
    // Явно выбранные «12 месяцев» на категориях переносятся на другие вкладки.
    expect(reportFiltersToSearchParams(LAST_12, TODAY).toString()).toBe(
      'from=2025-12-01&to=2026-11-30',
    )
  })

  it('сброс периода — к умолчанию вкладки', () => {
    expect(applyPatch(NOVEMBER, { from: null, to: null }, TODAY, trend)).toEqual(LAST_12)
  })

  it('чип периода — если период не умолчание вкладки', () => {
    const lookups = { accountNames: new Map<string, string>(), today: TODAY }
    expect(reportFilterChips(LAST_12, { ...lookups, defaultPreset: trend }, t)).toEqual([])
    expect(
      reportFilterChips(NOVEMBER, { ...lookups, defaultPreset: trend }, t).map((c) => c.label),
    ).toEqual([t.feed.filters.periods.thisMonth])
    expect(reportFilterChips(LAST_12, lookups, t).map((c) => c.label)).toEqual([
      t.feed.filters.periods.last12Months,
    ])
  })
})

describe('по месяцам и баланс: запросы и ссылки', () => {
  it('параметры без пустых массивов; у баланса нет автора', () => {
    expect(toMonthlyReportParams(NOVEMBER)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(toMonthlyReportParams({ ...NOVEMBER, accountId: [A], authorId: [U] })).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      accountId: [A],
      authorId: [U],
    })
    expect(toBalanceReportParams({ ...NOVEMBER, accountId: [A], authorId: [U] })).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      accountId: [A],
    })
  })

  it('последний день месяца', () => {
    expect(monthEnd('2026-02-01')).toBe('2026-02-28')
    expect(monthEnd('2028-02-01')).toBe('2028-02-29')
    expect(monthEnd('2026-12-01')).toBe('2026-12-31')
  })

  it('месяц → лента: вид, счета, автор; месяц обрезан периодом отчёта', () => {
    const filters = {
      ...NOVEMBER,
      from: '2025-12-15',
      to: '2026-11-20',
      accountId: [A],
      authorId: [U],
    }
    const parse = (link: string) => {
      const [path, query] = link.split('?')
      expect(path).toBe('/transactions')
      return parseFilters(new URLSearchParams(query))
    }
    expect(parse(monthFeedLink(filters, '2026-03-01', 'income'))).toEqual({
      from: '2026-03-01',
      to: '2026-03-31',
      kind: ['income'],
      accountId: [A],
      categoryId: [],
      authorId: [U],
      q: '',
    })
    expect(parse(monthFeedLink(filters, '2025-12-01', 'expense'))).toMatchObject({
      from: '2025-12-15',
      to: '2025-12-31',
      kind: ['expense'],
    })
    expect(parse(monthFeedLink(filters, '2026-11-01', 'expense'))).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-20',
    })
  })
})
