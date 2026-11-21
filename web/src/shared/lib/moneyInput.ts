import { messages, type Messages } from '../i18n'

/** Предел суммы из контракта (`MoneyAmount`): ±10^15 минимальных единиц. */
export const MAX_MONEY_AMOUNT = 1_000_000_000_000_000

export type ParseMoneyResult =
  | { ok: true; value: number }
  /** `empty` — поле пустое: обязательно ли оно, решает форма. */
  | { ok: false; code: 'empty' }
  | { ok: false; code: 'invalid' | 'tooLarge' | 'tooManyDecimals'; message: string }

// Пробелы, которые встречаются в числах: обычный, неразрывный (U+00A0), узкий неразрывный
// (U+202F — так Intl разделяет разряды) и тонкий (U+2009). Так вставленное «1 234,50 ₽» из
// другого места приложения тоже разберётся — кроме знака валюты.
const SPACES = /[\s   ]/g
// Знак минус: дефис с клавиатуры или настоящий «−» (U+2212), который показывает Money.
const NUMBER = /^([-−])?(\d*)(?:[.,](\d*))?$/

/**
 * Текст из поля суммы → целое число минимальных единиц валюты (копеек).
 * Работает на строках, без float: «0,1» + «0,2» здесь не превратятся в 0,30000000000000004.
 *
 * - Дробная часть — после запятой или точки, не больше `minorUnits` знаков.
 * - Пробелы между разрядами разрешены: «1 234,5».
 * - Минус — `-` или `−`: начальный остаток и фактический остаток могут быть отрицательными.
 * - Результат в пределах `MoneyAmount` (±10^15).
 *
 * Временный помощник: на этапе 3 его заменит `AmountInput` с калькулятором.
 */
export function parseMoneyInput(
  text: string,
  minorUnits: number,
  t: Messages = messages,
): ParseMoneyResult {
  const compact = text.replace(SPACES, '')
  if (compact === '') return { ok: false, code: 'empty' }

  const invalid = { ok: false, code: 'invalid', message: t.moneyInput.invalid } as const
  const match = NUMBER.exec(compact)
  if (!match) return invalid
  const [, minus, intPart = '', fracPart = ''] = match
  // Хотя бы одна цифра: «-», «,» и «-,» — не числа. «,5» и «5,» — числа.
  if (intPart === '' && fracPart === '') return invalid

  if (fracPart.length > minorUnits) {
    return {
      ok: false,
      code: 'tooManyDecimals',
      message:
        minorUnits === 0 ? t.moneyInput.integerOnly : t.moneyInput.tooManyDecimals(minorUnits),
    }
  }

  // Ведущие нули отбрасываем, чтобы длина строки честно говорила о величине числа.
  const digits = (intPart + fracPart.padEnd(minorUnits, '0')).replace(/^0+(?=\d)/, '')
  // Больше 16 цифр — заведомо больше предела; до 16 цифр Number хранит целое точно.
  if (digits.length > 16 || Number(digits) > MAX_MONEY_AMOUNT) {
    return { ok: false, code: 'tooLarge', message: t.moneyInput.tooLarge }
  }

  const value = Number(digits)
  // «-0» → 0, а не −0: иначе Object.is и JSON вели бы себя неожиданно.
  return { ok: true, value: minus && value !== 0 ? -value : value }
}

/**
 * Сумма в минимальных единицах → текст для поля ввода: `-123456` → «-1234,56», `120000` → «1200».
 * Без разделителей разрядов и знака валюты — чтобы текст было удобно править
 * и `parseMoneyInput` разобрал его обратно в то же число.
 */
export function formatMoneyInput(amount: number, minorUnits: number): string {
  const sign = amount < 0 ? '-' : ''
  const abs = String(Math.abs(amount)).padStart(minorUnits + 1, '0')
  if (minorUnits === 0) return sign + abs
  const intPart = abs.slice(0, -minorUnits)
  const fracPart = abs.slice(-minorUnits).replace(/0+$/, '')
  return sign + intPart + (fracPart ? ',' + fracPart : '')
}
