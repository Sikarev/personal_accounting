import type { CurrencyTotal } from '../../lib/accounts'
import { Money } from '../Money/Money'
import classes from './BalanceTotals.module.css'

export type BalanceTotalsProps = {
  /**
   * Итог по валютам (`totalsByCurrency`): рубли первыми. Пусто (нет счетов в балансе) —
   * показывается «0 ₽».
   */
  totals: readonly CurrencyTotal[]
  /** Id подписи («Всего на счетах») — имя списка для экранного диктора. */
  labelledBy?: string
}

/**
 * Общий баланс — главная цифра главной (ux.md, «Главная»). Пересчёта в рубли до этапа 4
 * нет, поэтому сумма по каждой валюте отдельно: первая (рубли) — крупно, остальные —
 * под ней мельче, в ряд с переносом.
 *
 * Суммы округлены до рублей (ux.md, «Деньги»: в балансах — до рублей). Отрицательный
 * итог — красным, как проблема (`variant="balance"`), знак есть всегда. Огромная сумма
 * при крупном шрифте переносится по разрядам (`Money wrap`), а не по символам.
 */
export function BalanceTotals({ totals, labelledBy }: BalanceTotalsProps) {
  const [main, ...rest] = totals.length > 0 ? totals : [{ currency: 'RUB', amount: 0 }]
  return (
    <ul className={classes.list} aria-labelledby={labelledBy}>
      <li className={classes.main}>
        <Money
          amount={main.amount}
          currency={main.currency}
          variant="balance"
          roundToMajor
          wrap
          className={classes.amount}
        />
      </li>
      {rest.map((total) => (
        <li key={total.currency} className={classes.other}>
          <Money
            amount={total.amount}
            currency={total.currency}
            variant="balance"
            roundToMajor
            wrap
            className={classes.amount}
          />
        </li>
      ))}
    </ul>
  )
}
