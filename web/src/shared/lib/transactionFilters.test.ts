import { describe, expect, it } from 'vitest'

import {
  detectPreset,
  EMPTY_FILTERS,
  filtersToSearchParams,
  hasActiveFilters,
  parseFilters,
  presetPeriod,
  toListParams,
  type FeedFilters,
} from './transactionFilters'

const A = '01a1faf8-0000-7000-8000-0000000000a1'
const B = '01a1faf8-0000-7000-8000-0000000000a2'
const C = '01a1faf8-0000-7000-8000-0000000000c1'
const U = '01a1faf8-0000-7000-8000-000000000001'

const parse = (query: string) => parseFilters(new URLSearchParams(query))

describe('parseFilters', () => {
  it('пустой адрес — фильтров нет', () => {
    expect(parse('')).toEqual(EMPTY_FILTERS)
  })

  it('все фильтры, массивы — повторением параметра', () => {
    expect(
      parse(
        `from=2026-11-01&to=2026-11-30&kind=expense&kind=income&accountId=${A}&accountId=${B}&categoryId=${C}&authorId=${U}&q=кофе`,
      ),
    ).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      kind: ['expense', 'income'],
      accountId: [A, B],
      categoryId: [C],
      authorId: [U],
      q: 'кофе',
    })
  })

  it('повреждённые значения отбрасываются, а не ломают ленту', () => {
    expect(
      parse(
        `from=2026-02-31&to=вчера&kind=refund&kind=expense&kind=expense&accountId=1&accountId=${A}&accountId=${A}`,
      ),
    ).toEqual({ ...EMPTY_FILTERS, kind: ['expense'], accountId: [A] })
  })

  it('поиск длиннее 200 символов обрезается', () => {
    expect(parse(`q=${'а'.repeat(250)}`).q).toHaveLength(200)
  })
})

describe('filtersToSearchParams', () => {
  it('туда и обратно — те же фильтры', () => {
    const filters: FeedFilters = {
      from: '2026-11-01',
      to: null,
      kind: ['transfer', 'adjustment'],
      accountId: [B, A],
      categoryId: [C],
      authorId: [U],
      q: ' молоко ',
    }
    const params = filtersToSearchParams(filters)
    expect(params.getAll('kind')).toEqual(['transfer', 'adjustment'])
    expect(parseFilters(params)).toEqual(filters)
  })

  it('пустые фильтры в адрес не попадают', () => {
    expect(filtersToSearchParams(EMPTY_FILTERS).toString()).toBe('')
  })
})

describe('toListParams', () => {
  it('без пустых, поиск без пробелов по краям', () => {
    expect(toListParams({ ...EMPTY_FILTERS, kind: ['income'], q: '  кофе ' })).toEqual({
      kind: ['income'],
      q: 'кофе',
    })
  })

  it('автор — в параметрах запроса', () => {
    expect(toListParams({ ...EMPTY_FILTERS, authorId: [U] })).toEqual({ authorId: [U] })
  })

  it('поиск из пробелов — без фильтра', () => {
    expect(toListParams({ ...EMPTY_FILTERS, q: '   ' })).toEqual({})
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: '   ' })).toBe(false)
  })
})

describe('hasActiveFilters', () => {
  it.each<[string, Partial<FeedFilters>]>([
    ['from', { from: '2026-11-01' }],
    ['to', { to: '2026-11-01' }],
    ['kind', { kind: ['expense'] }],
    ['accountId', { accountId: [A] }],
    ['categoryId', { categoryId: [C] }],
    ['authorId', { authorId: [U] }],
    ['q', { q: 'кофе' }],
  ])('%s', (_, patch) => {
    expect(hasActiveFilters({ ...EMPTY_FILTERS, ...patch })).toBe(true)
  })

  it('пустые — нет', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false)
  })
})

describe('presetPeriod', () => {
  const today = '2026-11-23'

  it('этот месяц — целиком', () => {
    expect(presetPeriod('thisMonth', today)).toEqual({ from: '2026-11-01', to: '2026-11-30' })
  })

  it('прошлый месяц', () => {
    expect(presetPeriod('lastMonth', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })

  it('прошлый месяц в январе — декабрь прошлого года', () => {
    expect(presetPeriod('lastMonth', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    })
  })

  it('февраль високосного года', () => {
    expect(presetPeriod('thisMonth', '2028-02-10')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    })
    expect(presetPeriod('lastMonth', '2026-03-31')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })

  it('этот год', () => {
    expect(presetPeriod('thisYear', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('всё время и свой период — без границ', () => {
    expect(presetPeriod('all', today)).toEqual({ from: null, to: null })
    expect(presetPeriod('custom', today)).toEqual({ from: null, to: null })
  })
})

describe('detectPreset', () => {
  const today = '2026-11-23'

  it('узнаёт готовые периоды', () => {
    expect(detectPreset({ from: null, to: null }, today)).toBe('all')
    expect(detectPreset({ from: '2026-11-01', to: '2026-11-30' }, today)).toBe('thisMonth')
    expect(detectPreset({ from: '2026-10-01', to: '2026-10-31' }, today)).toBe('lastMonth')
    expect(detectPreset({ from: '2026-01-01', to: '2026-12-31' }, today)).toBe('thisYear')
  })

  it('остальное — свой период', () => {
    expect(detectPreset({ from: '2026-11-01', to: '2026-11-15' }, today)).toBe('custom')
    expect(detectPreset({ from: '2026-11-01', to: null }, today)).toBe('custom')
    // Период считается от «сегодня»: ссылка на ноябрь в декабре — «Прошлый месяц»,
    // ссылка на октябрь в декабре — свой период.
    expect(detectPreset({ from: '2026-11-01', to: '2026-11-30' }, '2026-12-01')).toBe('lastMonth')
    expect(detectPreset({ from: '2026-10-01', to: '2026-10-31' }, '2026-12-01')).toBe('custom')
  })
})
