import { Text, type TextProps } from '@mantine/core'
import type { ReactNode } from 'react'

import { formatMoneyParts, moneyTone, type MoneyVariant } from '../../lib/money'
import { semanticColors } from '../../../theme'
import classes from './Money.module.css'

export type { MoneyVariant }

export type MoneyProps = Omit<TextProps, 'c' | 'color' | 'variant'> & {
  /**
   * Сумма в минимальных единицах валюты (копейки, центы), со знаком. `bigint` — для сумм,
   * сложенных без потери точности (общий баланс может быть больше 2^53).
   */
  amount: number | bigint
  /** Код валюты ISO 4217: `RUB`, `USD`. */
  currency: string
  /** Знаков в минимальной единице; по умолчанию — по ISO 4217 (RUB, USD — 2, JPY — 0). */
  minorUnits?: number
  /** Округлить до целых (отчёты, балансы). */
  roundToMajor?: boolean
  /**
   * Как окрашивать сумму:
   * - `plain` — обычный цвет текста, знак только у отрицательных;
   * - `flow` — движение денег (лента): доход `+590 ₽` зелёным, расход `−590 ₽` обычным цветом;
   * - `balance` — остаток: отрицательный выделяется красным как проблема.
   *
   * Цвет и знак считаются по показанному (уже округлённому) значению: «0 ₽» всегда обычный.
   * Цвет никогда не единственный носитель смысла: знак есть всегда.
   */
  variant?: MoneyVariant
  /**
   * Разрешить перенос по разрядам: «999 999 999 / 999,99 ₽». Нужен там, где огромная
   * сумма при крупном шрифте не помещается в строку (итог, узкая раскладка). Точки
   * переноса — `<wbr>` после разделителей разрядов: в копируемый текст не попадают
   * (в отличие от U+200B). По умолчанию сумма не переносится.
   */
  wrap?: boolean
  /** Вывести как `<span>` (по умолчанию) или другой тег. */
  component?: 'span' | 'div' | 'p'
}

/**
 * Единственный способ показать сумму в интерфейсе (ux.md, раздел «Деньги»).
 * Табличные цифры, настоящий минус, копейки скрываются, если их нет; сумма не переносится.
 */
export function Money({
  amount,
  currency,
  minorUnits,
  roundToMajor,
  variant = 'plain',
  wrap = false,
  component = 'span',
  className,
  ...textProps
}: MoneyProps) {
  const { text, sign } = formatMoneyParts(amount, currency, {
    minorUnits,
    roundToMajor,
    signDisplay: variant === 'flow' ? 'always' : 'auto',
  })
  const tone = moneyTone(variant, sign)

  return (
    <Text
      component={component}
      inherit={textProps.size === undefined && textProps.fz === undefined}
      {...textProps}
      c={tone && semanticColors[tone]}
      className={className ? `${classes.root} ${className}` : classes.root}
      data-wrap={wrap || undefined}
    >
      {wrap ? withBreakOpportunities(text) : text}
    </Text>
  )
}

// Разделители, которые ставит Intl для ru-RU: неразрывный и узкий неразрывный пробелы.
const SEPARATOR = /([\u00a0\u202f])/
const DIGIT = /^\d/

/**
 * `<wbr>` после разделителей разрядов: строка та же, но браузер может перенести здесь.
 * Перед знаком валюты точки переноса нет — «₽» не уезжает на отдельную строку.
 */
function withBreakOpportunities(text: string): ReactNode[] {
  const parts = text.split(SEPARATOR)
  return parts.flatMap((part, i) => {
    if (!part) return []
    const betweenDigits = SEPARATOR.test(part) && DIGIT.test(parts[i + 1] ?? '')
    return betweenDigits ? [part, <wbr key={i} />] : [part]
  })
}
