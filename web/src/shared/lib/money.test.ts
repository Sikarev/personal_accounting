import { describe, expect, it } from 'vitest'

import { formatMoney, MINUS } from './money'

// Intl ставит неразрывные пробелы (U+00A0, в некоторых версиях ICU — U+202F).
// Сравниваем видимый текст, а отдельный тест проверяет, что пробелы неразрывные.
const visible = (value: string) => value.replace(/[  ]/g, ' ')

describe('formatMoney', () => {
  it('показывает копейки, если они есть', () => {
    expect(visible(formatMoney(1234567, 'RUB'))).toBe('12 345,67 ₽')
    expect(visible(formatMoney(5, 'RUB'))).toBe('0,05 ₽')
    expect(visible(formatMoney(150, 'RUB'))).toBe('1,50 ₽')
  })

  it('скрывает копейки, если их нет', () => {
    expect(visible(formatMoney(120000, 'RUB'))).toBe('1 200 ₽')
    expect(visible(formatMoney(100, 'RUB'))).toBe('1 ₽')
    expect(visible(formatMoney(0, 'RUB'))).toBe('0 ₽')
  })

  it('округляет до рублей по опции, половина — вверх по модулю', () => {
    expect(visible(formatMoney(123449, 'RUB', { roundToMajor: true }))).toBe('1 234 ₽')
    expect(visible(formatMoney(123450, 'RUB', { roundToMajor: true }))).toBe('1 235 ₽')
    expect(visible(formatMoney(-123450, 'RUB', { roundToMajor: true }))).toBe(`${MINUS}1 235 ₽`)
    expect(visible(formatMoney(99, 'RUB', { roundToMajor: true }))).toBe('1 ₽')
  })

  it('ставит настоящий минус U+2212, а не дефис', () => {
    const value = formatMoney(-120000, 'RUB')
    expect(visible(value)).toBe('−1 200 ₽')
    expect(value.charCodeAt(0)).toBe(0x2212)
    expect(value).not.toContain('-')
  })

  it('не ставит минус у нуля после округления', () => {
    expect(visible(formatMoney(-40, 'RUB', { roundToMajor: true }))).toBe('0 ₽')
  })

  it('ставит «+» перед положительной суммой по опции', () => {
    expect(visible(formatMoney(59000, 'RUB', { signDisplay: 'always' }))).toBe('+590 ₽')
    expect(visible(formatMoney(-59000, 'RUB', { signDisplay: 'always' }))).toBe('−590 ₽')
    expect(visible(formatMoney(0, 'RUB', { signDisplay: 'always' }))).toBe('0 ₽')
  })

  it('форматирует доллары по-русски: символ после суммы, запятая', () => {
    expect(visible(formatMoney(5000, 'USD'))).toBe('50 $')
    expect(visible(formatMoney(5050, 'USD'))).toBe('50,50 $')
    expect(visible(formatMoney(-123456, 'USD'))).toBe('−1 234,56 $')
  })

  it('учитывает число знаков в минимальной единице', () => {
    expect(visible(formatMoney(1500, 'JPY', { minorUnits: 0 }))).toBe('1 500 ¥')
    expect(visible(formatMoney(1234, 'RUB', { minorUnits: 3 }))).toBe('1,234 ₽')
  })

  it('точно форматирует большие суммы без потерь float', () => {
    expect(visible(formatMoney(123456789012345, 'RUB'))).toBe('1 234 567 890 123,45 ₽')
    expect(visible(formatMoney(Number.MAX_SAFE_INTEGER, 'RUB'))).toBe('90 071 992 547 409,91 ₽')
    expect(visible(formatMoney(1_000_000_000_00, 'RUB'))).toBe('1 000 000 000 ₽')
  })

  it('использует неразрывные пробелы, чтобы сумма не переносилась по строкам', () => {
    expect(formatMoney(120000, 'RUB')).not.toContain(' ')
  })

  it('отвергает дробное число вместо минимальных единиц', () => {
    expect(() => formatMoney(12.5, 'RUB')).toThrow(RangeError)
  })
})
