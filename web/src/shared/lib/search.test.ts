import { describe, expect, it } from 'vitest'

import { matchesSearch, normalizeSearch } from './search'

describe('normalizeSearch', () => {
  it('нижний регистр и ё → е', () => {
    expect(normalizeSearch('ЁЛКА Ёжик')).toBe('елка ежик')
  })

  it('пробелы по краям и подряд', () => {
    expect(normalizeSearch('  Кафе   и\tрестораны ')).toBe('кафе и рестораны')
  })

  it('латиница и цифры не меняются, кроме регистра', () => {
    expect(normalizeSearch('Netflix 4K')).toBe('netflix 4k')
  })
})

describe('matchesSearch', () => {
  it.each([
    ['Ёлка', 'елк'],
    ['Елка', 'ЁЛК'],
    ['Продукты › Молочное', 'молоч'],
    ['Продукты › Молочное', 'продукты  ›'],
    ['Кафе и рестораны', 'и рест'],
  ])('«%s» находится по «%s»', (text, query) => {
    expect(matchesSearch(text, query)).toBe(true)
  })

  it('пустой запрос и одни пробелы подходят ко всему', () => {
    expect(matchesSearch('Транспорт', '')).toBe(true)
    expect(matchesSearch('Транспорт', '   ')).toBe(true)
  })

  it('нет совпадения', () => {
    expect(matchesSearch('Транспорт', 'такси')).toBe(false)
  })
})
