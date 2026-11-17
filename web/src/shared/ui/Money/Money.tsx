import { Text, type TextProps } from '@mantine/core'

import { formatMoney } from '../../lib/money'
import { semanticColors } from '../../../theme'
import classes from './Money.module.css'

export type MoneyVariant = 'plain' | 'flow' | 'balance'

export type MoneyProps = Omit<TextProps, 'c' | 'color' | 'variant'> & {
  /** Сумма в минимальных единицах валюты (копейки, центы), со знаком. */
  amount: number
  /** Код валюты ISO 4217: `RUB`, `USD`. */
  currency: string
  /** Знаков в минимальной единице. */
  minorUnits?: number
  /** Округлить до целых (отчёты, балансы). */
  roundToMajor?: boolean
  /**
   * Как окрашивать сумму:
   * - `plain` — обычный цвет текста, знак только у отрицательных;
   * - `flow` — движение денег (лента): доход `+590 ₽` зелёным, расход `−590 ₽` обычным цветом;
   * - `balance` — остаток: отрицательный выделяется красным как проблема.
   *
   * Цвет никогда не единственный носитель смысла: знак есть всегда.
   */
  variant?: MoneyVariant
  /** Вывести как `<span>` (по умолчанию) или другой тег. */
  component?: 'span' | 'div' | 'p'
}

function colorFor(variant: MoneyVariant, amount: number): string | undefined {
  if (variant === 'flow' && amount > 0) return semanticColors.income
  if (variant === 'balance' && amount < 0) return semanticColors.negative
  return undefined
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
  component = 'span',
  className,
  ...textProps
}: MoneyProps) {
  const text = formatMoney(amount, currency, {
    minorUnits,
    roundToMajor,
    signDisplay: variant === 'flow' ? 'always' : 'auto',
  })

  return (
    <Text
      component={component}
      inherit={textProps.size === undefined && textProps.fz === undefined}
      {...textProps}
      c={colorFor(variant, amount)}
      className={className ? `${classes.root} ${className}` : classes.root}
    >
      {text}
    </Text>
  )
}
