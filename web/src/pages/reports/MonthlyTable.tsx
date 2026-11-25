import { Text, VisuallyHidden } from '@mantine/core'
import { useId, useState } from 'react'
import { Link } from 'react-router'

import type { MonthlyReportItem } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { Money } from '../../shared/ui'
import { monthFeedLink, type ReportFilters, type ReportKind } from './reportFilters'
import { ShowAllButton } from './ShowAllButton'
import { monthLabel, tableRows, type MonthlyTotals } from './trendReport'
import classes from './ReportsPage.module.css'

/**
 * Таблица отчёта по месяцам — текстовый эквивалент графика: месяц, доходы, расходы,
 * разница; внизу «Итого» за весь период. Новые месяцы сверху, как в ленте; больше
 * 12 месяцев — свёрнуто, остальные по кнопке.
 *
 * Доходы и расходы месяца — две отдельные ссылки в ленту (с `kind=income` и
 * `kind=expense`): сумма, на которую нажали, — ровно то, что покажет лента. Ссылка
 * на месяц без вида смешала бы в ленте доходы, расходы и переводы, и сверить сумму
 * было бы не с чем. У нулевой суммы ссылки нет — лента была бы пустой.
 *
 * Роли ARIA повторяют родные: в узком блоке строки перестраиваются через display (CSS),
 * а смена display у элементов таблицы в части браузеров стирает её смысл для диктора.
 */
export function MonthlyTable({
  items,
  totals,
  currency,
  filters,
  caption,
}: {
  items: MonthlyReportItem[]
  totals: MonthlyTotals
  currency: string
  filters: ReportFilters
  caption: string
}) {
  const t = useT()
  const id = useId()
  const [expanded, setExpanded] = useState(false)
  const rows = tableRows(items, expanded)
  const s = t.reports.monthly.series

  return (
    <div className={classes.tableBlock}>
      <table className={classes.trendTable} role="table" id={id} data-columns="4">
        <caption className={classes.visuallyHidden}>{caption}</caption>
        <thead className={classes.trendHead} role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              {t.reports.monthly.table.month}
            </th>
            <th scope="col" role="columnheader">
              {s.income}
            </th>
            <th scope="col" role="columnheader">
              {s.expense}
            </th>
            <th scope="col" role="columnheader">
              {s.difference}
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((item) => {
            const month = monthLabel(item.month, t)
            return (
              <tr key={item.month} role="row" className={classes.trendRow}>
                <th scope="row" role="rowheader" className={classes.trendLabel}>
                  {month}
                </th>
                <AmountLink
                  kind="income"
                  label={s.income}
                  amount={item.income}
                  currency={currency}
                  href={monthFeedLink(filters, item.month, 'income')}
                  context={t.reports.monthly.table.linkContext(s.income.toLowerCase(), month)}
                />
                <AmountLink
                  kind="expense"
                  label={s.expense}
                  amount={item.expense}
                  currency={currency}
                  href={monthFeedLink(filters, item.month, 'expense')}
                  context={t.reports.monthly.table.linkContext(s.expense.toLowerCase(), month)}
                />
                <td role="cell" className={classes.trendCell}>
                  <CellLabel>{s.difference}</CellLabel>
                  <span className={classes.cellValue}>
                    <Money
                      amount={item.income - item.expense}
                      currency={currency}
                      roundToMajor
                      variant="flow"
                      wrap
                    />
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot role="rowgroup">
          <tr role="row" className={classes.trendRow} data-total>
            <th scope="row" role="rowheader" className={classes.trendLabel}>
              {t.reports.monthly.table.total}
            </th>
            <td role="cell" className={classes.trendCell}>
              <CellLabel>{s.income}</CellLabel>
              <Money amount={totals.income} currency={currency} roundToMajor wrap fw={600} />
            </td>
            <td role="cell" className={classes.trendCell}>
              <CellLabel>{s.expense}</CellLabel>
              <Money amount={totals.expense} currency={currency} roundToMajor wrap fw={600} />
            </td>
            <td role="cell" className={classes.trendCell}>
              <CellLabel>{s.difference}</CellLabel>
              <Money
                amount={totals.difference}
                currency={currency}
                roundToMajor
                variant="flow"
                wrap
                fw={600}
              />
            </td>
          </tr>
        </tfoot>
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

/**
 * Подпись колонки внутри ячейки — видна только в узком блоке, где строка таблицы
 * становится карточкой. Для диктора есть заголовок колонки, поэтому подпись скрыта.
 */
function CellLabel({ children }: { children: string }) {
  return (
    <Text component="span" size="xs" c="dimmed" className={classes.cellLabel} aria-hidden>
      {children}
    </Text>
  )
}

function AmountLink({
  kind,
  label,
  amount,
  currency,
  href,
  context,
}: {
  kind: ReportKind
  label: string
  amount: number
  currency: string
  href: string
  /** Для диктора после суммы: « — доходы, Ноябрь 2026» (в списке ссылок сумма одна непонятна). */
  context: string
}) {
  return (
    <td role="cell" className={classes.trendCell} data-kind={kind}>
      <CellLabel>{label}</CellLabel>
      {amount === 0 ? (
        <span className={classes.cellValue}>
          <Money amount={0} currency={currency} roundToMajor />
        </span>
      ) : (
        <Link to={href} className={`${classes.cellValue} ${classes.amountLink}`}>
          <Money amount={amount} currency={currency} roundToMajor wrap />
          <VisuallyHidden>{context}</VisuallyHidden>
        </Link>
      )}
    </td>
  )
}
