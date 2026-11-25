import { Text, VisuallyHidden } from '@mantine/core'
import { Fragment } from 'react'

import { useT } from '../../i18n'
import { BASE_CURRENCY, type BalanceSummary, type CurrencyTotal } from '../../lib/accounts'
import { Money } from '../Money/Money'
import classes from './BalanceTotals.module.css'

export type BalanceTotalsProps = {
  /** Итог по счетам (`balanceSummary`). Нет счетов в балансе — «0 ₽». */
  summary: BalanceSummary
  /**
   * Округлить до рублей (главная — ux.md, «Деньги»: в балансах до рублей). На «Счетах»
   * суммы с копейками — там остаток сверяют с банком.
   */
  roundToMajor?: boolean
}

/**
 * Общий баланс — главная цифра главной и «Счетов» (ux.md, «Главная»): одна сумма
 * в рублях, включая валютные счета по курсу ЦБ.
 *
 * - Есть валютные счета — сумма приблизительная: перед ней «≈», под ней мелко и
 *   приглушённо «Включая 500 $ по курсу ЦБ» — откуда взялась часть суммы.
 * - У валюты нет курса — её счета в сумму не входят: их итоги в исходной валюте показаны
 *   отдельно (деньги не «пропадают») и спокойное пояснение, без красного — это не ошибка
 *   пользователя.
 * - Только рубли — одна сумма, без лишних строк.
 *
 * Отрицательный итог — красным, как проблема (`variant="balance"`), знак есть всегда.
 * Огромная сумма при крупном шрифте переносится по разрядам (`Money wrap`).
 */
export function BalanceTotals({ summary, roundToMajor = true }: BalanceTotalsProps) {
  const t = useT()
  const { total, converted, withoutRate } = summary
  const approximate = converted.length > 0
  return (
    <div className={classes.root}>
      <p className={classes.main} data-balance-total>
        {approximate && (
          <>
            {/* Неразрывный пробел: «≈» не остаётся один на строке. */}
            <span aria-hidden>≈{' '}</span>
            <VisuallyHidden component="span">{t.balance.approximately} </VisuallyHidden>
          </>
        )}
        <Money
          amount={total}
          currency={BASE_CURRENCY}
          variant="balance"
          roundToMajor={roundToMajor}
          wrap
          className={classes.amount}
        />
      </p>
      {approximate && (
        <Text size="sm" c="dimmed" className={classes.note}>
          {t.balance.includesStart}{' '}
          <AmountList totals={converted} roundToMajor={roundToMajor} and={t.balance.and} />{' '}
          {t.balance.includesEnd}
        </Text>
      )}
      {withoutRate.length > 0 && (
        <>
          <ul className={classes.other}>
            {withoutRate.map((item) => (
              <li key={item.currency}>
                <Money
                  amount={item.amount}
                  currency={item.currency}
                  variant="balance"
                  roundToMajor={roundToMajor}
                  wrap
                  className={classes.amount}
                />
              </li>
            ))}
          </ul>
          <Text size="sm" c="dimmed" className={classes.note}>
            {t.balance.withoutRate(
              joinWords(
                withoutRate.map((x) => x.currency),
                t.balance.and,
              ),
            )}
          </Text>
        </>
      )}
    </div>
  )
}

/** «500 $», «500 $ и 1 200 €», «500 $, 1 200 € и 30 ¥». */
function AmountList({
  totals,
  roundToMajor,
  and,
}: {
  totals: readonly CurrencyTotal[]
  roundToMajor: boolean
  and: string
}) {
  return totals.map((item, i) => (
    <Fragment key={item.currency}>
      {i > 0 && (i === totals.length - 1 ? ` ${and} ` : ', ')}
      <Money amount={item.amount} currency={item.currency} roundToMajor={roundToMajor} wrap />
    </Fragment>
  ))
}

function joinWords(words: readonly string[], and: string): string {
  if (words.length < 2) return words.join('')
  return `${words.slice(0, -1).join(', ')} ${and} ${words[words.length - 1]}`
}
