import { Text, Title, VisuallyHidden } from '@mantine/core'

import type { CurrencyTotal } from '../../api'
import { useT } from '../../i18n'
import { formatOpDate } from '../../lib/date'
import { totalAmounts } from '../../lib/transactionFeed'
import { Money } from '../Money/Money'
import classes from './TransactionDayHeader.module.css'

export type TransactionDayHeaderProps = {
  /** Дата группы `YYYY-MM-DD`. */
  date: string
  /** «Сегодня» пользователя (`useToday()`) — для «Сегодня», «Вчера» и года. */
  today: string
  /** Итог дня от сервера: по валютам, расходы и доходы. */
  totals: readonly CurrencyTotal[]
  /** Id заголовка — для `aria-labelledby` группы. */
  id?: string
  /** Уровень заголовка дня: 2 — под заголовком экрана (лента), 3 — внутри блока. */
  headingOrder?: 2 | 3
}

/**
 * Заголовок дня в ленте: «Сегодня», «Вчера», «Пн, 16 ноября», «16 ноября 2025» и справа
 * итог дня — расходы со знаком «−» обычным цветом, доходы «+» зелёным, по каждой валюте.
 * Нулевые суммы не показываются. Итог переносится целыми суммами, если не помещается.
 */
export function TransactionDayHeader({
  date,
  today,
  totals,
  id,
  headingOrder = 2,
}: TransactionDayHeaderProps) {
  const t = useT()
  const amounts = totalAmounts(totals)
  return (
    <div className={classes.root}>
      <Title order={headingOrder} size="sm" fw={600} id={id} className={classes.date}>
        {formatOpDate(date, today)}
      </Title>
      {amounts.length > 0 && (
        <Text component="p" size="sm" className={classes.totals}>
          <VisuallyHidden>{t.feed.dayTotalLabel}: </VisuallyHidden>
          {amounts.map((a) => (
            <Money
              key={`${a.currency}${a.amount > 0 ? '+' : '-'}`}
              amount={a.amount}
              currency={a.currency}
              variant="flow"
              wrap
              className={classes.amount}
            />
          ))}
        </Text>
      )}
    </div>
  )
}
