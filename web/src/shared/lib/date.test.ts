import { describe, expect, it } from 'vitest'

import { formatOpDate } from './date'

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
