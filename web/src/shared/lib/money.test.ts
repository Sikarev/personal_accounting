import { describe, expect, it } from 'vitest'

import {
  formatExchangeRate,
  formatMoney,
  formatMoneyParts,
  getMinorUnits,
  MINUS,
  moneyTone,
} from './money'

describe('moneyTone (цвет компонента Money)', () => {
  it('−40 коп. с округлением до рублей — «0 ₽» обычным цветом, не красным', () => {
    const { sign } = formatMoneyParts(-40, 'RUB', { roundToMajor: true })
    expect(moneyTone('balance', sign)).toBeUndefined()
  })

  it('+40 коп. с округлением в ленте — не зелёный «0 ₽»', () => {
    const { sign } = formatMoneyParts(40, 'RUB', { roundToMajor: true, signDisplay: 'always' })
    expect(moneyTone('flow', sign)).toBeUndefined()
  })

  it('отрицательный остаток — красный, доход в ленте — зелёный, расход — обычный', () => {
    expect(moneyTone('balance', -1)).toBe('negative')
    expect(moneyTone('flow', 1)).toBe('income')
    expect(moneyTone('flow', -1)).toBeUndefined()
    expect(moneyTone('plain', -1)).toBeUndefined()
    expect(moneyTone('balance', 1)).toBeUndefined()
  })
})

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

  it('знак считается по показанному значению, а не по исходной сумме', () => {
    expect(formatMoneyParts(-40, 'RUB', { roundToMajor: true }).sign).toBe(0)
    expect(formatMoneyParts(40, 'RUB', { roundToMajor: true, signDisplay: 'always' })).toEqual({
      text: '0 ₽',
      sign: 0,
    })
    expect(formatMoneyParts(-60, 'RUB', { roundToMajor: true }).sign).toBe(-1)
    expect(formatMoneyParts(-40, 'RUB').sign).toBe(-1)
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

  it('берёт число знаков валюты из ISO 4217 через Intl', () => {
    expect(getMinorUnits('RUB')).toBe(2)
    expect(getMinorUnits('USD')).toBe(2)
    expect(getMinorUnits('JPY')).toBe(0)
    // У иены нет «копеек»: 1500 минимальных единиц — это 1 500 ¥, а не 15 ¥.
    expect(visible(formatMoney(1500, 'JPY'))).toBe('1 500 ¥')
  })

  it('явный minorUnits важнее стандарта валюты', () => {
    expect(visible(formatMoney(1500, 'JPY', { minorUnits: 2 }))).toBe('15 ¥')
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

describe('formatExchangeRate', () => {
  // Intl ставит неразрывные пробелы — сравниваем с обычными для читаемости.
  const rate = (...args: Parameters<typeof formatExchangeRate>) =>
    formatExchangeRate(...args)?.replace(/[  ]/g, ' ')

  it('слева единица более «дорогой» валюты', () => {
    // Списали 9 235 ₽, зачислили 100 $.
    expect(rate(923_500, 'RUB', 10_000, 'USD')).toBe('1 $ = 92,35 ₽')
    // Обратный обмен: списали 100 $, получили 9 235 ₽ — тот же курс.
    expect(rate(10_000, 'USD', 923_500, 'RUB')).toBe('1 $ = 92,35 ₽')
  })

  it('2–4 знака после запятой, половина — от нуля', () => {
    expect(rate(1_000_000, 'RUB', 10_000, 'USD')).toBe('1 $ = 100,00 ₽')
    // 10 000 ₽ / 107,33 $ = 93,17059…
    expect(rate(1_000_000, 'RUB', 10_733, 'USD')).toBe('1 $ = 93,1706 ₽')
  })

  it('учитывает знаки валют: иена без дробной части', () => {
    // 15 000 ¥ за 100 $.
    expect(rate(10_000, 'USD', 15_000, 'JPY', { toMinorUnits: 0 })).toBe('1 $ = 150,00 ¥')
  })

  it('без сумм курса нет', () => {
    expect(formatExchangeRate(0, 'RUB', 100, 'USD')).toBeNull()
    expect(formatExchangeRate(100, 'RUB', 0, 'USD')).toBeNull()
  })
})
