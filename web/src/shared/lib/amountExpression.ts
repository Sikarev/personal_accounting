import { messages, type Messages } from '../i18n'
import { SPACES } from './moneyInput'

/**
 * Поле суммы операции — калькулятор (ux.md, «Быстрый ввод»): `350+120*2` → 590.
 *
 * Разбор свой, без `eval` и зависимостей. Числа — точные дроби на BigInt (числитель и
 * знаменатель), поэтому `0,1+0,2` даёт ровно 0,3, а `100/3*3` — ровно 100: float здесь
 * не участвует. До минимальных единиц валюты округляется только итог.
 *
 * Округление — арифметическое («половина — от нуля»): 0,125 → 0,13, 10/3 → 3,33.
 * Так считают «на бумаге», и так же округляет `formatMoney` с `roundToMajor`; банковское
 * (0,125 → 0,12) удивило бы пользователя, который проверяет результат в уме.
 */

/** Сумма операции в контракте (`TransactionAmount`): 1…10^13 минимальных единиц. */
export const MIN_TRANSACTION_AMOUNT = 1
export const MAX_TRANSACTION_AMOUNT = 10_000_000_000_000

/** Длина ввода: выражение на чек хватает с запасом, а разбор остаётся мгновенным. */
export const AMOUNT_INPUT_MAX_LENGTH = 100

export type AmountErrorCode =
  'invalid' | 'divisionByZero' | 'notPositive' | 'tooLarge' | 'tooManyDecimals'

export type AmountResult =
  /** `isExpression` — введено выражение, а не одно число: под полем показывается «= итог». */
  | { ok: true; value: number; isExpression: boolean }
  /** Поле пустое: обязательно ли оно, решает форма. */
  | { ok: false; code: 'empty'; isExpression: false }
  | { ok: false; code: AmountErrorCode; message: string; isExpression: boolean }

type Fraction = { n: bigint; d: bigint }

type Token =
  | { type: 'number'; value: Fraction; decimals: number }
  | { type: 'op'; op: '+' | '-' | '*' | '/' }
  | { type: 'paren'; open: boolean }

// Операторы: ASCII с клавиатуры, «−» (U+2212, его показывает Money), «×», «·» и «÷»,
// двоеточие — так делят в школе.
const OPERATORS: Record<string, '+' | '-' | '*' | '/'> = {
  '+': '+',
  '-': '-',
  '−': '-',
  '*': '*',
  '×': '*',
  '·': '*',
  '/': '/',
  '÷': '/',
  ':': '/',
}

const NUMBER = /^(\d*)(?:[.,](\d*))?/

class ParseError extends Error {
  readonly code: AmountErrorCode
  constructor(code: AmountErrorCode) {
    super(code)
    this.code = code
  }
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const op = OPERATORS[ch]
    if (op) {
      tokens.push({ type: 'op', op })
      i += 1
    } else if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', open: ch === '(' })
      i += 1
    } else {
      const match = NUMBER.exec(text.slice(i))
      const [whole, intPart = '', fracPart = ''] = match ?? []
      // Хотя бы одна цифра: «,» и «.» сами по себе — не числа; «,5» и «5,» — числа.
      if (!whole || (intPart === '' && fracPart === '')) throw new ParseError('invalid')
      tokens.push({
        type: 'number',
        value: { n: BigInt(intPart + fracPart || '0'), d: 10n ** BigInt(fracPart.length) },
        decimals: fracPart.length,
      })
      i += whole.length
    }
  }
  return tokens
}

/** Разбор рекурсивным спуском: сложение ниже умножения, скобки и унарный знак — выше. */
function parse(tokens: Token[]): { value: Fraction; isExpression: boolean } {
  let pos = 0
  let isExpression = false

  const peek = () => tokens[pos]

  const expression = (): Fraction => {
    let left = term()
    for (let t = peek(); t?.type === 'op' && (t.op === '+' || t.op === '-'); t = peek()) {
      pos += 1
      isExpression = true
      const right = term()
      left =
        t.op === '+'
          ? { n: left.n * right.d + right.n * left.d, d: left.d * right.d }
          : { n: left.n * right.d - right.n * left.d, d: left.d * right.d }
    }
    return left
  }

  const term = (): Fraction => {
    let left = factor()
    for (let t = peek(); t?.type === 'op' && (t.op === '*' || t.op === '/'); t = peek()) {
      pos += 1
      isExpression = true
      const right = factor()
      if (t.op === '*') {
        left = { n: left.n * right.n, d: left.d * right.d }
      } else {
        if (right.n === 0n) throw new ParseError('divisionByZero')
        // Знаменатель держим положительным: знак — только в числителе.
        const sign = right.n < 0n ? -1n : 1n
        left = { n: left.n * right.d * sign, d: left.d * right.n * sign }
      }
    }
    return left
  }

  const factor = (): Fraction => {
    const t = peek()
    if (t?.type === 'op' && (t.op === '-' || t.op === '+')) {
      pos += 1
      const value = factor()
      return t.op === '-' ? { n: -value.n, d: value.d } : value
    }
    if (t?.type === 'number') {
      pos += 1
      return t.value
    }
    if (t?.type === 'paren' && t.open) {
      pos += 1
      isExpression = true
      const value = expression()
      const close = peek()
      if (close?.type !== 'paren' || close.open) throw new ParseError('invalid')
      pos += 1
      return value
    }
    throw new ParseError('invalid')
  }

  const value = expression()
  if (pos !== tokens.length) throw new ParseError('invalid')
  return { value, isExpression }
}

/** Дробь → целое число минимальных единиц, «половина — от нуля». */
export function roundToMinorUnits({ n, d }: Fraction, minorUnits: number): bigint {
  const scaled = (n < 0n ? -n : n) * 10n ** BigInt(minorUnits)
  // floor((2·x + d) / 2d) = округление x/d «половина вверх» для x ≥ 0.
  const rounded = (2n * scaled + d) / (2n * d)
  return n < 0n ? -rounded : rounded
}

/**
 * Текст поля суммы → сумма операции в минимальных единицах.
 *
 * - Числа: десятичная запятая или точка, пробелы игнорируются (`1 234,5`).
 * - Операторы `+ − * /` (и `× ÷ :`), скобки, унарный минус.
 * - Одно число — не больше `minorUnits` знаков после запятой (как `parseMoneyInput`:
 *   «1.234» скорее опечатка в разделителе разрядов, чем 1,23 ₽). В выражении дробные
 *   множители допустимы (`1,5*300`), итог округляется до минимальных единиц.
 * - Итог — от 1 до 10^13 минимальных единиц (`TransactionAmount`).
 */
export function evaluateAmount(
  text: string,
  minorUnits: number,
  t: Messages = messages,
): AmountResult {
  const compact = text.replace(SPACES, '')
  if (compact === '') return { ok: false, code: 'empty', isExpression: false }

  let tokens: Token[]
  let parsed: { value: Fraction; isExpression: boolean }
  try {
    tokens = tokenize(compact)
    parsed = parse(tokens)
  } catch (error) {
    if (!(error instanceof ParseError)) throw error
    // Любой оператор или скобка во вводе — это попытка выражения: текст ошибки про него.
    const isExpression = /[-+−*×·/÷:()]/.test(compact.replace(/^[-−+]/, ''))
    return fail(error.code, isExpression, minorUnits, t)
  }

  const { value, isExpression } = parsed
  if (!isExpression) {
    const literal = tokens.find((token) => token.type === 'number')
    if (literal && literal.decimals > minorUnits) {
      return fail('tooManyDecimals', false, minorUnits, t)
    }
  }

  const rounded = roundToMinorUnits(value, minorUnits)
  if (rounded < BigInt(MIN_TRANSACTION_AMOUNT))
    return fail('notPositive', isExpression, minorUnits, t)
  if (rounded > BigInt(MAX_TRANSACTION_AMOUNT)) return fail('tooLarge', isExpression, minorUnits, t)
  return { ok: true, value: Number(rounded), isExpression }
}

function fail(
  code: AmountErrorCode,
  isExpression: boolean,
  minorUnits: number,
  t: Messages,
): AmountResult {
  return {
    ok: false,
    code,
    message: amountErrorText(code, isExpression, minorUnits, t),
    isExpression,
  }
}

function amountErrorText(
  code: AmountErrorCode,
  isExpression: boolean,
  minorUnits: number,
  t: Messages,
): string {
  switch (code) {
    case 'invalid':
      return isExpression ? t.amountInput.invalidExpression : t.moneyInput.invalid
    case 'divisionByZero':
      return t.amountInput.divisionByZero
    case 'notPositive':
      return t.amountInput.notPositive
    case 'tooLarge':
      return t.moneyInput.tooLarge
    case 'tooManyDecimals':
      return minorUnits === 0 ? t.moneyInput.integerOnly : t.moneyInput.tooManyDecimals(minorUnits)
  }
}
