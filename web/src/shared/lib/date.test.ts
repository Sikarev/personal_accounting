import { describe, expect, it } from 'vitest'

import { formatOpDate, isCalendarDate, shiftDate, todayIn } from './date'

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

describe('shiftDate', () => {
  it.each([
    ['2026-11-23', -1, '2026-11-22'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2024-03-01', -1, '2024-02-29'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2026-12-31', 1, '2027-01-01'],
    // Переход на летнее время не сдвигает дату: считаем в UTC.
    ['2026-03-29', -1, '2026-03-28'],
  ])('%s %+d → %s', (date, days, expected) => {
    expect(shiftDate(date, days)).toBe(expected)
  })
})

describe('isCalendarDate', () => {
  it.each([
    ['2026-11-23', true],
    ['2024-02-29', true],
    ['2026-02-29', false],
    ['2026-02-31', false],
    ['2026-13-01', false],
    ['', false],
    ['23.11.2026', false],
  ])('%s → %s', (value, expected) => {
    expect(isCalendarDate(value)).toBe(expected)
  })
})
