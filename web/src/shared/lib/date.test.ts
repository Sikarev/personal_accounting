import { describe, expect, it } from 'vitest'

import { formatOpDate, formatPeriod, isCalendarDate, todayIn } from './date'

describe('todayIn', () => {
  // 21:30 UTC 17 ноября = 00:30 18 ноября в Москве (UTC+3).
  const justAfterMoscowMidnight = new Date('2026-11-17T21:30:00Z')
  // 20:59 UTC = 23:59 в Москве — ещё 17 ноября.
  const justBeforeMoscowMidnight = new Date('2026-11-17T20:59:00Z')

  it('около полуночи по Москве даты в Москве и UTC расходятся', () => {
    expect(todayIn('Europe/Moscow', justAfterMoscowMidnight)).toBe('2026-11-18')
    expect(todayIn('UTC', justAfterMoscowMidnight)).toBe('2026-11-17')
  })

  it('за минуту до полуночи по Москве — ещё вчерашняя дата', () => {
    expect(todayIn('Europe/Moscow', justBeforeMoscowMidnight)).toBe('2026-11-17')
    expect(todayIn('UTC', justBeforeMoscowMidnight)).toBe('2026-11-17')
  })

  it('пояс западнее UTC: в UTC уже завтра, в Нью-Йорке ещё сегодня', () => {
    const now = new Date('2026-01-01T02:00:00Z')
    expect(todayIn('UTC', now)).toBe('2026-01-01')
    expect(todayIn('America/New_York', now)).toBe('2025-12-31')
  })

  it('результат подходит для formatOpDate', () => {
    expect(formatOpDate('2026-11-17', todayIn('Europe/Moscow', justAfterMoscowMidnight))).toBe(
      'Вчера',
    )
  })

  it('отвергает неизвестный пояс', () => {
    expect(() => todayIn('Mars/Olympus')).toThrow(RangeError)
  })
})

const today = '2026-11-18' // среда

describe('formatOpDate', () => {
  it('сегодня и вчера — словами', () => {
    expect(formatOpDate('2026-11-18', today)).toBe('Сегодня')
    expect(formatOpDate('2026-11-17', today)).toBe('Вчера')
  })

  it('этот год — день недели с заглавной буквы и дата', () => {
    expect(formatOpDate('2026-11-16', today)).toBe('Пн, 16 ноября')
    expect(formatOpDate('2026-01-01', today)).toBe('Чт, 1 января')
  })

  it('прошлые годы — с годом, без «г.»', () => {
    expect(formatOpDate('2025-11-16', today)).toBe('16 ноября 2025')
    expect(formatOpDate('2025-12-31', today)).toBe('31 декабря 2025')
  })

  it('«вчера» работает через границу года', () => {
    expect(formatOpDate('2025-12-31', '2026-01-01')).toBe('Вчера')
    expect(formatOpDate('2025-12-30', '2026-01-01')).toBe('30 декабря 2025')
  })

  it('не сдвигается на переходе через летнее время и в високосный год', () => {
    expect(formatOpDate('2024-02-28', '2024-02-29')).toBe('Вчера')
    expect(formatOpDate('2026-03-28', '2026-03-29')).toBe('Вчера')
  })

  it('принимает Date: берёт локальную календарную дату', () => {
    expect(formatOpDate(new Date(2026, 10, 18, 23, 59), new Date(2026, 10, 18, 0, 1))).toBe(
      'Сегодня',
    )
    expect(formatOpDate('2026-11-17', new Date(2026, 10, 18, 0, 0))).toBe('Вчера')
  })

  it('будущие даты этого года — обычным форматом', () => {
    expect(formatOpDate('2026-11-19', today)).toBe('Чт, 19 ноября')
  })

  it('отвергает строку не в формате YYYY-MM-DD', () => {
    expect(() => formatOpDate('18.11.2026', today)).toThrow(RangeError)
  })
})

describe('isCalendarDate', () => {
  it('существующие даты', () => {
    expect(isCalendarDate('2026-11-23')).toBe(true)
    expect(isCalendarDate('2024-02-29')).toBe(true)
  })

  it('несуществующие и не в формате YYYY-MM-DD', () => {
    expect(isCalendarDate('2026-02-31')).toBe(false)
    expect(isCalendarDate('2025-02-29')).toBe(false)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2026-1-01')).toBe(false)
    expect(isCalendarDate('')).toBe(false)
  })
})

describe('formatPeriod', () => {
  const today = '2026-11-23'

  it('в одном месяце текущего года — без года', () => {
    expect(formatPeriod('2026-11-01', '2026-11-15', today)).toBe('1–15 ноября')
  })

  it('в одном месяце прошлого года — с годом', () => {
    expect(formatPeriod('2025-11-01', '2025-11-30', today)).toBe('1–30 ноября 2025')
  })

  it('один день', () => {
    expect(formatPeriod('2026-11-05', '2026-11-05', today)).toBe('5 ноября')
    expect(formatPeriod('2025-11-05', '2025-11-05', today)).toBe('5 ноября 2025')
  })

  it('разные месяцы одного года', () => {
    expect(formatPeriod('2026-10-20', '2026-11-05', today)).toBe('20 октября – 5 ноября')
    expect(formatPeriod('2025-10-20', '2025-11-05', today)).toBe('20 октября – 5 ноября 2025')
  })

  it('через Новый год — год у обеих дат', () => {
    expect(formatPeriod('2025-12-28', '2026-01-05', today)).toBe('28 декабря 2025 – 5 января 2026')
  })

  it('открытый период', () => {
    expect(formatPeriod('2026-11-01', null, today)).toBe('с 1 ноября')
    expect(formatPeriod(null, '2025-11-15', today)).toBe('по 15 ноября 2025')
    expect(formatPeriod(null, null, today)).toBe('')
  })
})
