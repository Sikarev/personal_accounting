import { describe, expect, it } from 'vitest'

import { ru as t } from '../../shared/i18n/ru'
import {
  compareTotals,
  comparisonPeriod,
  comparisonText,
  formatShare,
  periodLabel,
  periodLead,
  periodShape,
} from './reportPeriod'

const TODAY = '2026-11-24'
/** Intl ставит неразрывный пробел перед «%» — в ожиданиях обычный. */
const plain = (text: string) => text.replace(/ /g, ' ')

describe('periodShape и подписи', () => {
  it('месяц, год, отрезок', () => {
    expect(periodShape({ from: '2026-02-01', to: '2026-02-28' })).toEqual({
      type: 'month',
      year: 2026,
      month: 2,
    })
    expect(periodShape({ from: '2025-01-01', to: '2025-12-31' })).toEqual({
      type: 'year',
      year: 2025,
    })
    expect(periodShape({ from: '2026-02-01', to: '2026-02-27' })).toEqual({ type: 'range' })
  })

  it('начало вывода: «В ноябре», с годом — если он не текущий', () => {
    expect(periodLead({ from: '2026-11-01', to: '2026-11-30' }, TODAY, t)).toBe('В ноябре')
    expect(periodLead({ from: '2025-05-01', to: '2025-05-31' }, TODAY, t)).toBe('В мае 2025 года')
    expect(periodLead({ from: '2026-01-01', to: '2026-12-31' }, TODAY, t)).toBe('В 2026 году')
    expect(periodLead({ from: '2026-11-01', to: '2026-11-15' }, TODAY, t)).toBe('За 1–15 ноября')
  })

  it('подпись периода', () => {
    expect(periodLabel({ from: '2026-11-01', to: '2026-11-30' }, TODAY, t)).toBe('Ноябрь 2026')
    expect(periodLabel({ from: '2026-01-01', to: '2026-12-31' }, TODAY, t)).toBe('2026 год')
  })
})

describe('comparisonPeriod', () => {
  it('прошлый месяц — с целым месяцем перед ним', () => {
    expect(comparisonPeriod({ from: '2026-10-01', to: '2026-10-31' }, TODAY)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      wholeMonth: true,
    })
  })

  it('текущий месяц — те же дни прошлого месяца', () => {
    expect(comparisonPeriod({ from: '2026-11-01', to: '2026-11-30' }, TODAY)).toEqual({
      from: '2026-10-01',
      to: '2026-10-24',
      wholeMonth: false,
    })
    // 31 марта — с 1 по 28 февраля.
    expect(comparisonPeriod({ from: '2026-03-01', to: '2026-03-31' }, '2026-03-31')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
      wholeMonth: false,
    })
    // Январь — с декабрём прошлого года.
    expect(comparisonPeriod({ from: '2026-01-01', to: '2026-01-31' }, '2026-01-10')).toEqual({
      from: '2025-12-01',
      to: '2025-12-10',
      wholeMonth: false,
    })
  })

  it('год — тот же отрезок прошлого года', () => {
    expect(comparisonPeriod({ from: '2026-01-01', to: '2026-12-31' }, TODAY)).toEqual({
      from: '2025-01-01',
      to: '2025-11-24',
      wholeMonth: false,
    })
    expect(comparisonPeriod({ from: '2028-01-01', to: '2028-12-31' }, '2028-02-29')).toEqual({
      from: '2027-01-01',
      to: '2027-02-28',
      wholeMonth: false,
    })
  })

  it('свой период — без сравнения', () => {
    expect(comparisonPeriod({ from: '2026-11-01', to: '2026-11-15' }, TODAY)).toBeNull()
    // Целый, но не «прошлый» месяц — тоже свой период.
    expect(comparisonPeriod({ from: '2026-08-01', to: '2026-08-31' }, TODAY)).toBeNull()
  })
})

describe('compareTotals', () => {
  it('больше, меньше, почти столько же', () => {
    expect(compareTotals(8_430_000, 9_580_000)).toEqual({ direction: 'less', percent: 12 })
    expect(compareTotals(150, 100)).toEqual({ direction: 'more', percent: 50 })
    expect(compareTotals(1001, 1000)).toEqual({ direction: 'same', percent: 0 })
  })

  it('в прошлом периоде ничего — без сравнения', () => {
    expect(compareTotals(100, 0)).toBeNull()
  })
})

describe('comparisonText', () => {
  it('с целым месяцем и с отрезком', () => {
    expect(
      plain(
        comparisonText(
          { direction: 'less', percent: 12 },
          { from: '2026-10-01', to: '2026-10-31', wholeMonth: true },
          TODAY,
          t,
        ),
      ),
    ).toBe('На 12 % меньше, чем в октябре')
    expect(
      plain(
        comparisonText(
          { direction: 'more', percent: 5 },
          { from: '2026-10-01', to: '2026-10-24', wholeMonth: false },
          TODAY,
          t,
        ),
      ),
    ).toBe('На 5 % больше, чем за 1–24 октября')
    expect(
      comparisonText(
        { direction: 'same', percent: 0 },
        { from: '2025-01-01', to: '2025-11-24', wholeMonth: false },
        TODAY,
        t,
      ),
    ).toBe('Почти столько же, сколько за 1 января – 24 ноября 2025')
  })
})

describe('formatShare', () => {
  it('целые проценты, крошечная доля — «< 1 %»', () => {
    expect(plain(formatShare(25, 100, t))).toBe('25 %')
    expect(plain(formatShare(1, 1000, t))).toBe(t.reports.table.lessThanOnePercent)
    expect(plain(formatShare(0, 0, t))).toBe('0 %')
  })
})
