import { LOCALE } from '../i18n'

/** Настоящий знак минуса (U+2212): дефис в суммах выглядит коротким и «прыгает» в колонках. */
export const MINUS = '−'

export type FormatMoneyOptions = {
  /** Сколько знаков в минимальной единице валюты: 2 для RUB и USD. */
  minorUnits?: number
  /** Округлить до целых (отчёты и балансы): копейки не показываются никогда. */
  roundToMajor?: boolean
  /** `'always'` — ставить «+» перед положительной суммой (доходы в ленте). Ноль без знака. */
  signDisplay?: 'auto' | 'always'
}

const formatters = new Map<string, Intl.NumberFormat>()

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

/**
 * Форматирует сумму в минимальных единицах валюты: `formatMoney(123456, 'RUB')` → `1 234,56 ₽`.
 *
 * - Копейки скрываются, если их нет: `120000` → `1 200 ₽`.
 * - Минус — U+2212, разделители — неразрывные пробелы (как отдаёт Intl для ru-RU).
 * - Считаем в целых числах и передаём в Intl строку, а не float: `0.1 + 0.2` здесь не случится.
 *
 * Для отображения в интерфейсе используйте компонент `Money`, а не эту функцию напрямую.
 */
export function formatMoney(
  amount: number,
  currency: string,
  { minorUnits = 2, roundToMajor = false, signDisplay = 'auto' }: FormatMoneyOptions = {},
): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(
      `formatMoney: сумма должна быть целым числом минимальных единиц, получено ${amount}`,
    )
  }

  const factor = 10 ** minorUnits
  const abs = Math.abs(amount)
  let major = Math.floor(abs / factor)
  let minor = abs % factor

  if (roundToMajor) {
    // Округление «половина вверх» по модулю: −0,50 ₽ → −1 ₽, как и 0,50 ₽ → 1 ₽.
    if (minor * 2 >= factor) major += 1
    minor = 0
  }

  const fractionDigits = minor === 0 ? 0 : minorUnits
  const decimal = fractionDigits
    ? `${major}.${String(minor).padStart(minorUnits, '0')}`
    : `${major}`

  const body = getFormatter(currency, fractionDigits).format(decimal as `${number}`)

  const isZero = major === 0 && minor === 0
  if (isZero) return body
  if (amount < 0) return MINUS + body
  if (signDisplay === 'always') return '+' + body
  return body
}
