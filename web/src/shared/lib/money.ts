import { LOCALE } from '../i18n'

/** Настоящий знак минуса (U+2212): дефис в суммах выглядит коротким и «прыгает» в колонках. */
export const MINUS = '−'

export type FormatMoneyOptions = {
  /**
   * Сколько знаков в минимальной единице валюты. По умолчанию — по стандарту ISO 4217
   * из Intl: 2 для RUB и USD, 0 для JPY. Явное значение имеет приоритет.
   */
  minorUnits?: number
  /** Округлить до целых (отчёты и балансы): копейки не показываются никогда. */
  roundToMajor?: boolean
  /** `'always'` — ставить «+» перед положительной суммой (доходы в ленте). Ноль без знака. */
  signDisplay?: 'auto' | 'always'
}

export type MoneyParts = {
  /** Готовая строка: `−1 200 ₽`. */
  text: string
  /**
   * Знак показанного значения — уже после округления: −40 коп. с `roundToMajor`
   * показываются как «0 ₽», и знак у них 0. По нему, а не по исходной сумме,
   * выбирается цвет: «0 ₽» красным быть не должен.
   */
  sign: -1 | 0 | 1
}

const formatters = new Map<string, Intl.NumberFormat>()
const currencyDigits = new Map<string, number>()

// Intl.NumberFormat дорого создавать, а в ленте сотни сумм — кэшируем по параметрам.
function getFormatter(currency: string, fractionDigits: number): Intl.NumberFormat {
  const key = `${currency}:${fractionDigits}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      // «$», а не «US$»: валют в приложении мало, путаницы нет.
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
    formatters.set(key, formatter)
  }
  return formatter
}

/** Знаков в минимальной единице валюты по ISO 4217 (берём из Intl): RUB → 2, JPY → 0. */
export function getMinorUnits(currency: string): number {
  let digits = currencyDigits.get(currency)
  if (digits === undefined) {
    digits = new Intl.NumberFormat(LOCALE, { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits as number
    currencyDigits.set(currency, digits)
  }
  return digits
}

/**
 * Сумма в минимальных единицах → текст и знак показанного значения.
 * Используется компонентом `Money`; для простого текста есть `formatMoney`.
 */
export function formatMoneyParts(
  amount: number,
  currency: string,
  { minorUnits, roundToMajor = false, signDisplay = 'auto' }: FormatMoneyOptions = {},
): MoneyParts {
  // Дробное число — ошибка вызывающего кода (суммы — целые минимальные единицы).
  // А целое больше 2^53 бывает в честных данных: итог «за всё время» по огромным суммам
  // приходит из JSON уже с потерей точности. Экран из-за него падать не должен —
  // считаем в BigInt и показываем значение как есть.
  if (!Number.isInteger(amount)) {
    throw new RangeError(
      `formatMoney: сумма должна быть целым числом минимальных единиц, получено ${amount}`,
    )
  }

  const digits = minorUnits ?? getMinorUnits(currency)
  const factor = 10n ** BigInt(digits)
  const abs = BigInt(Math.abs(amount))
  let major = abs / factor
  let minor = abs % factor

  if (roundToMajor) {
    // Округление «половина вверх» по модулю: −0,50 ₽ → −1 ₽, как и 0,50 ₽ → 1 ₽.
    if (minor * 2n >= factor) major += 1n
    minor = 0n
  }

  const fractionDigits = minor === 0n ? 0 : digits
  // Считаем в целых числах и передаём в Intl строку, а не float: 0.1 + 0.2 здесь не случится.
  const decimal = fractionDigits ? `${major}.${String(minor).padStart(digits, '0')}` : `${major}`

  const body = getFormatter(currency, fractionDigits).format(decimal as `${number}`)

  if (major === 0n && minor === 0n) return { text: body, sign: 0 }
  if (amount < 0) return { text: MINUS + body, sign: -1 }
  return { text: signDisplay === 'always' ? '+' + body : body, sign: 1 }
}

export type MoneyVariant = 'plain' | 'flow' | 'balance'

/**
 * Смысловой цвет суммы по варианту отображения и знаку показанного значения:
 * доход в ленте — `income`, отрицательный остаток — `negative`, остальное — цвет текста.
 */
export function moneyTone(
  variant: MoneyVariant,
  sign: MoneyParts['sign'],
): 'income' | 'negative' | undefined {
  if (variant === 'flow' && sign > 0) return 'income'
  if (variant === 'balance' && sign < 0) return 'negative'
  return undefined
}

/**
 * Форматирует сумму в минимальных единицах валюты: `formatMoney(123456, 'RUB')` → `1 234,56 ₽`.
 *
 * - Копейки скрываются, если их нет: `120000` → `1 200 ₽`.
 * - Минус — U+2212, разделители — неразрывные пробелы (как отдаёт Intl для ru-RU).
 *
 * Для отображения в интерфейсе используйте компонент `Money`, а не эту функцию напрямую.
 */
export function formatMoney(
  amount: number,
  currency: string,
  options?: FormatMoneyOptions,
): string {
  return formatMoneyParts(amount, currency, options).text
}

const rateFormatters = new Map<string, Intl.NumberFormat>()

/** Знаков после запятой в курсе: 2–4, как у курсов в банковских приложениях. */
const RATE_DIGITS = 4

/**
 * Курс обмена по двум суммам перевода (в минимальных единицах своих валют):
 * `formatExchangeRate(923_500, 'RUB', 10_000, 'USD')` → `1 $ = 92,35 ₽`.
 *
 * Слева всегда единица более «дорогой» валюты: «1 $ = 92,35 ₽», а не «1 ₽ = 0,0108 $».
 * Считается в целых числах (BigInt), округление — половина от нуля, до 4 знаков.
 * Неположительная сумма — курса нет, `null`.
 */
export function formatExchangeRate(
  fromAmount: number,
  fromCurrency: string,
  toAmount: number,
  toCurrency: string,
  { fromMinorUnits, toMinorUnits }: { fromMinorUnits?: number; toMinorUnits?: number } = {},
): string | null {
  if (fromAmount <= 0 || toAmount <= 0) return null
  const fromDigits = fromMinorUnits ?? getMinorUnits(fromCurrency)
  const toDigits = toMinorUnits ?? getMinorUnits(toCurrency)
  // Сколько «from» за одну единицу «to»: (from / 10^fd) / (to / 10^td).
  const fromPerTo = {
    n: BigInt(fromAmount) * 10n ** BigInt(toDigits),
    d: BigInt(toAmount) * 10n ** BigInt(fromDigits),
  }
  const toIsBase = fromPerTo.n >= fromPerTo.d
  const base = toIsBase ? toCurrency : fromCurrency
  const baseDigits = toIsBase ? toDigits : fromDigits
  const quote = toIsBase ? fromCurrency : toCurrency
  const { n, d } = toIsBase ? fromPerTo : { n: fromPerTo.d, d: fromPerTo.n }

  const scale = 10n ** BigInt(RATE_DIGITS)
  const scaled = (2n * n * scale + d) / (2n * d)
  const intPart = scaled / scale
  const fracPart = String(scaled % scale).padStart(RATE_DIGITS, '0')

  let formatter = rateFormatters.get(quote)
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: quote,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: RATE_DIGITS,
    })
    rateFormatters.set(quote, formatter)
  }
  const one = formatMoney(10 ** baseDigits, base, { minorUnits: baseDigits })
  return `${one} = ${formatter.format(`${intPart}.${fracPart}` as `${number}`)}`
}
