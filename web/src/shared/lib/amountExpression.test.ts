import { describe, expect, it } from 'vitest'

import { ru as t } from '../i18n/ru'
import {
  evaluateAmount,
  MAX_TRANSACTION_AMOUNT,
  roundToMinorUnits,
  type AmountResult,
} from './amountExpression'

const value = (text: string, minorUnits = 2) => {
  const result = evaluateAmount(text, minorUnits)
  return result.ok ? result.value : result.code
}

describe('evaluateAmount: числа', () => {
  it.each([
    ['1', 100],
    ['590', 59000],
    ['1250,5', 125050],
    ['1250.50', 125050],
    ['0,01', 1],
    [',5', 50],
    ['5,', 500],
    ['007', 700],
    ['1 234 567,89', 123456789],
    // Неразрывный и узкий неразрывный пробелы (так разделяет разряды Intl).
    ['1 234 567', 123456700],
    ['  12  ', 1200],
  ])('«%s» → %d', (text, expected) => {
    expect(value(text)).toBe(expected)
  })

  it('одно число — не выражение', () => {
    expect(evaluateAmount('590', 2)).toEqual({ ok: true, value: 59000, isExpression: false })
  })

  it('пустое поле', () => {
    expect(value('')).toBe('empty')
    expect(value('   ')).toBe('empty')
  })

  it('лишние знаки после запятой у одного числа — ошибка, а не округление', () => {
    // «1.234» скорее опечатка в разделителе разрядов, чем 1,23 ₽.
    const result = evaluateAmount('1.234', 2, t)
    expect(result).toMatchObject({ ok: false, code: 'tooManyDecimals' })
    expect(result.ok || result.code === 'empty' || result.message).toBe(
      t.moneyInput.tooManyDecimals(2),
    )
    expect(evaluateAmount('10,5', 0, t)).toMatchObject({
      code: 'tooManyDecimals',
      message: t.moneyInput.integerOnly,
    })
  })

  it('валюта без дробной части', () => {
    expect(value('150', 0)).toBe(150)
    expect(value('150', 3)).toBe(150000)
  })
})

describe('evaluateAmount: выражения', () => {
  it.each([
    ['350+120*2', 59000],
    ['350 + 120 * 2', 59000],
    ['(350+120)*2', 94000],
    ['1000-250', 75000],
    ['100/4', 2500],
    ['0,1+0,2', 30],
    ['100/3*3', 10000],
    ['2*(3+(4-1))', 1200],
    ['-5+10', 500],
    ['10*-1+20', 1000],
    ['+5', 500],
    // Символы с экрана и привычные «школьные»: − × · ÷ :
    ['350−50', 30000],
    ['3×4', 1200],
    ['3·4', 1200],
    ['12÷4', 300],
    ['12:4', 300],
    // Дробные множители в выражении допустимы, итог округляется.
    ['1,5*300', 45000],
    ['0,333*3', 100],
  ])('«%s» → %d', (text, expected) => {
    expect(value(text)).toBe(expected)
  })

  it('выражение помечено — под полем показывается итог', () => {
    expect(evaluateAmount('350+120*2', 2)).toEqual({ ok: true, value: 59000, isExpression: true })
    expect(evaluateAmount('(590)', 2)).toMatchObject({ ok: true, isExpression: true })
  })

  it.each([
    ['350+'],
    ['*5'],
    ['5**2'],
    ['(5+2'],
    ['5+2)'],
    ['()'],
    ['5 ₽'],
    ['abc'],
    ['1,2,3'],
    ['1.234,5'],
    [','],
  ])('неразборчивое «%s» — invalid', (text) => {
    expect(value(text)).toBe('invalid')
  })

  it('текст ошибки: для выражения — про знаки, для числа — пример ввода', () => {
    expect(evaluateAmount('350+', 2, t)).toMatchObject({
      message: t.amountInput.invalidExpression,
      isExpression: true,
    })
    expect(evaluateAmount('abc', 2, t)).toMatchObject({ message: t.moneyInput.invalid })
  })

  it('деление на ноль', () => {
    expect(evaluateAmount('5/0', 2, t)).toMatchObject({
      code: 'divisionByZero',
      message: t.amountInput.divisionByZero,
    })
    expect(value('5/(2-2)')).toBe('divisionByZero')
  })
})

describe('evaluateAmount: пределы', () => {
  it.each([['0'], ['0,00'], ['-5'], ['100-200'], ['0,004*1'], ['5-5']])(
    '«%s» — не больше нуля',
    (text) => {
      const result: AmountResult = evaluateAmount(text, 2, t)
      expect(result).toMatchObject({ ok: false, code: 'notPositive' })
      expect(!result.ok && result.code !== 'empty' && result.message).toBe(
        t.amountInput.notPositive,
      )
    },
  )

  it('минимум — одна минимальная единица, после округления', () => {
    expect(value('0,005')).toBe('tooManyDecimals')
    expect(value('0,01/2')).toBe(1) // 0,005 → 0,01
    expect(value('0,01/3')).toBe('notPositive') // 0,0033 → 0
  })

  it('максимум — 10^13 минимальных единиц', () => {
    expect(value('100000000000')).toBe(MAX_TRANSACTION_AMOUNT)
    expect(value('100000000000,01')).toBe('tooLarge')
    expect(value('99999999999*10')).toBe('tooLarge')
    expect(value('9'.repeat(40))).toBe('tooLarge')
    expect(evaluateAmount('1'.repeat(20), 2, t)).toMatchObject({ message: t.moneyInput.tooLarge })
  })
})

describe('roundToMinorUnits: половина — от нуля', () => {
  const round = (n: bigint, d: bigint, minorUnits = 2) => roundToMinorUnits({ n, d }, minorUnits)

  it.each([
    [125n, 1000n, 13n], // 0,125 → 0,13 (банковское дало бы 0,12)
    [135n, 1000n, 14n],
    [124n, 1000n, 12n],
    [10n, 3n, 333n], // 3,333… → 3,33
    [20n, 3n, 667n], // 6,666… → 6,67
    [-125n, 1000n, -13n],
    [0n, 1n, 0n],
  ])('%d/%d → %d', (n, d, expected) => {
    expect(round(n, d)).toBe(expected)
  })

  it('без дробной части: 2,5 → 3, 3,5 → 4', () => {
    expect(round(5n, 2n, 0)).toBe(3n)
    expect(round(7n, 2n, 0)).toBe(4n)
  })
})
