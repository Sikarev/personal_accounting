import { describe, expect, it } from 'vitest'

import { MINUS } from './money'
import { formatMoneyCompact } from './moneyCompact'

/** Intl ставит неразрывные пробелы — в ожиданиях обычные. */
const visible = (value: string) => value.replace(/[  ]/g, ' ')

describe('formatMoneyCompact (подписи осей)', () => {
  it('тысячи, миллионы — до трёх значащих цифр', () => {
    expect(visible(formatMoneyCompact(12_000_000, 'RUB'))).toBe('120 тыс. ₽')
    expect(visible(formatMoneyCompact(125_000_000, 'RUB'))).toBe('1,25 млн ₽')
    expect(visible(formatMoneyCompact(150_000, 'RUB'))).toBe('1,5 тыс. ₽')
    expect(visible(formatMoneyCompact(50_000, 'RUB'))).toBe('500 ₽')
    expect(visible(formatMoneyCompact(0, 'RUB'))).toBe('0 ₽')
  })

  it('до рублей: копейки округляются, половина — вверх по модулю', () => {
    expect(visible(formatMoneyCompact(49, 'RUB'))).toBe('0 ₽')
    expect(visible(formatMoneyCompact(50, 'RUB'))).toBe('1 ₽')
    expect(visible(formatMoneyCompact(-49, 'RUB'))).toBe('0 ₽')
  })

  it('отрицательные — с настоящим минусом', () => {
    expect(visible(formatMoneyCompact(-12_000_000, 'RUB'))).toBe(`${MINUS}120 тыс. ₽`)
  })

  it('дробное значение деления оси округляется до целой копейки', () => {
    expect(visible(formatMoneyCompact(12_499_999.6, 'RUB'))).toBe('125 тыс. ₽')
  })

  it('огромные суммы — без ошибок float', () => {
    // Больше 2^53 — только BigInt; копейки округляются в целых числах.
    expect(visible(formatMoneyCompact(9_007_199_254_740_993n, 'RUB'))).toBe('90,1 трлн ₽')
    expect(visible(formatMoneyCompact(99_999_999_999_999_949n, 'RUB'))).toBe('1000 трлн ₽')
    expect(visible(formatMoneyCompact(-999_999_999_999_999, 'RUB'))).toBe(`${MINUS}10 трлн ₽`)
    // Граница округления: 1 234 499 999,50 ₽ → 1 234 500 000 ₽ → «1,23 млрд» (а не «1,24»):
    // значащие цифры считаются от точного целого.
    expect(visible(formatMoneyCompact(123_449_999_950, 'RUB'))).toBe('1,23 млрд ₽')
  })

  it('валюта без дробной части и другая валюта', () => {
    expect(visible(formatMoneyCompact(120_000, 'JPY'))).toBe('120 тыс. ¥')
    expect(visible(formatMoneyCompact(12_000_000, 'USD'))).toBe('120 тыс. $')
  })
})
