import { LOCALE } from '../i18n'
import { getMinorUnits, MINUS } from './money'

// Отдельно от money.ts: нужен только графикам отчётов и попадает в их ленивый чанк,
// а не в первую загрузку вместе с `formatMoney`.

const compactFormatters = new Map<string, Intl.NumberFormat>()

/**
 * Короткая сумма для подписей осей графиков: `formatMoneyCompact(12_000_000, 'RUB')` →
 * `120 тыс. ₽`, `125_000_000` → `1,25 млн ₽` (до трёх значащих цифр, до рублей).
 *
 * Только для осей: точные суммы показывает `Money`. Значение деления оси может прийти
 * дробным (его выбирает библиотека графиков) — оно округляется до целой минимальной
 * единицы. Дальше счёт в BigInt, и в Intl уходит строка, а не float: на суммах больше
 * 2^53 деление на 100 в float дало бы чужие цифры.
 */
export function formatMoneyCompact(
  amount: number | bigint,
  currency: string,
  { minorUnits }: { minorUnits?: number } = {},
): string {
  const signed = typeof amount === 'bigint' ? amount : BigInt(Math.round(amount))
  const factor = 10n ** BigInt(minorUnits ?? getMinorUnits(currency))
  const abs = signed < 0n ? -signed : signed
  // До целых, «половина вверх» по модулю — как `roundToMajor` у `formatMoneyParts`.
  const major = abs / factor + ((abs % factor) * 2n >= factor ? 1n : 0n)

  let formatter = compactFormatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      notation: 'compact',
      maximumSignificantDigits: 3,
    })
    compactFormatters.set(currency, formatter)
  }
  const body = formatter.format(`${major}` as `${number}`)
  // Минус — свой, U+2212 (Intl ставит дефис).
  return signed < 0n && major > 0n ? MINUS + body : body
}
