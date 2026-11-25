import { useId, useState } from 'react'

import type { BalancePoint } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { formatPeriod } from '../../shared/lib/date'
import { Money } from '../../shared/ui'
import { ShowAllButton } from './ShowAllButton'
import { tableRows } from './trendReport'
import classes from './ReportsPage.module.css'

/**
 * Таблица баланса — текстовый эквивалент линии: дата точки и остаток на конец этого дня.
 * Новые сверху; длинный ряд (до 121 месяца за 10 лет) свёрнут до последних 12 значений,
 * остальные — по кнопке «Показать все значения».
 */
export function BalanceTable({
  items,
  currency,
  today,
  caption,
}: {
  items: BalancePoint[]
  currency: string
  today: string
  caption: string
}) {
  const t = useT()
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const rows = tableRows(items, expanded)

  return (
    <div className={classes.tableBlock}>
      <table className={classes.trendTable} role="table" id={id} data-columns="2">
        <caption className={classes.visuallyHidden}>{caption}</caption>
        <thead className={classes.trendHead} role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              {t.reports.balance.table.date}
            </th>
            <th scope="col" role="columnheader">
              {t.reports.balance.table.balance}
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((point) => (
            <tr key={point.date} role="row" className={classes.trendRow}>
              <th scope="row" role="rowheader" className={classes.trendLabel}>
                {formatPeriod(point.date, point.date, today)}
              </th>
              <td role="cell" className={classes.trendCell}>
                <Money
                  amount={point.balance}
                  currency={currency}
                  roundToMajor
                  variant="balance"
                  wrap
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ShowAllButton
        total={items.length}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        controls={id}
      />
    </div>
  )
}
