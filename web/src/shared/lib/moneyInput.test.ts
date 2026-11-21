import { describe, expect, it } from 'vitest'

import { ru as t } from '../i18n/ru'
import { formatMoneyInput, MAX_MONEY_AMOUNT, parseMoneyInput } from './moneyInput'

const value = (text: string, minorUnits = 2) => {
  const result = parseMoneyInput(text, minorUnits)
  return result.ok ? result.value : result.code
}

describe('parseMoneyInput', () => {
  it.each([
    ['0', 0],
    ['1', 100],
    ['1250', 125000],
    ['1250,5', 125050],
    ['1250.50', 125050],
    ['0,01', 1],
    [',5', 50],
    ['5,', 500],
    ['007', 700],
    ['1 234 567,89', 123456789],
    ['1 234,5', 123450],
    ['1 234', 123400],
    ['  12  ', 1200],
    ['-1200', -120000],
    ['−1 200,5', -120050],
    ['- 15', -1500],
    ['-0', 0],
    ['-0,00', 0],
  ])('«%s» → %s', (text, expected) => {
    expect(value(text)).toBe(expected)
  })

  it('-0 даёт обычный 0, а не −0', () => {
    expect(Object.is(value('-0'), 0)).toBe(true)
  })

  it.each(['', '   ', ' '])('пустое поле «%s» → empty без текста ошибки', (text) => {
    expect(parseMoneyInput(text, 2)).toEqual({ ok: false, code: 'empty' })
  })

  it.each(['-', ',', '-,', 'abc', '12a', '1,2,3', '1.2.3', '1 000,00 ₽', '--5', '+5', '5-', '1e5'])(
    '«%s» — не число',
    (text) => {
      expect(parseMoneyInput(text, 2)).toEqual({
        ok: false,
        code: 'invalid',
        message: t.moneyInput.invalid,
      })
    },
  )

  it('лишние знаки после запятой — ошибка с числом знаков', () => {
    expect(parseMoneyInput('1,234', 2)).toEqual({
      ok: false,
      code: 'tooManyDecimals',
      message: 'Не больше 2 знаков после запятой',
    })
  })

  it('валюта без дробной части (minorUnits = 0)', () => {
    expect(value('1500', 0)).toBe(1500)
    expect(parseMoneyInput('15,5', 0)).toEqual({
      ok: false,
      code: 'tooManyDecimals',
      message: t.moneyInput.integerOnly,
    })
  })

  it('три знака (minorUnits = 3)', () => {
    expect(value('1,5', 3)).toBe(1500)
    expect(value('1,005', 3)).toBe(1005)
  })

  it('предел MoneyAmount: ±10^15 минимальных единиц включительно', () => {
    expect(value('10000000000000')).toBe(MAX_MONEY_AMOUNT)
    expect(value('-10000000000000')).toBe(-MAX_MONEY_AMOUNT)
    expect(value('10000000000000,01')).toBe('tooLarge')
    expect(value('99999999999999999999')).toBe('tooLarge')
    // Ведущие нули не делают число «длинным».
    expect(value('00000000000000000001')).toBe(100)
  })

  it('крупная сумма без потери точности', () => {
    expect(value('9 999 999 999 999,99')).toBe(999_999_999_999_999)
  })
})

describe('formatMoneyInput', () => {
  it.each([
    [0, 2, '0'],
    [5, 2, '0,05'],
    [50, 2, '0,5'],
    [120000, 2, '1200'],
    [123456, 2, '1234,56'],
    [-123450, 2, '-1234,5'],
    [1500, 0, '1500'],
    [-7, 0, '-7'],
    [999_999_999_999_999, 2, '9999999999999,99'],
  ])('%i (%i знака) → «%s»', (amount, minorUnits, expected) => {
    expect(formatMoneyInput(amount, minorUnits)).toBe(expected)
  })

  it.each([0, 1, -1, 99, 100, -120050, MAX_MONEY_AMOUNT, -MAX_MONEY_AMOUNT])(
    'обратимо: parseMoneyInput(formatMoneyInput(%i)) — то же число',
    (amount) => {
      expect(value(formatMoneyInput(amount, 2))).toBe(amount)
    },
  )
})
