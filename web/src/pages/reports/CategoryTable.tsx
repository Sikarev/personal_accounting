import { ActionIcon, Text } from '@mantine/core'
import { IconChevronRight } from '@tabler/icons-react'
import { Fragment, useState } from 'react'
import { Link } from 'react-router'

import { useT } from '../../shared/i18n'
import { Money } from '../../shared/ui'
import { chartColors, icons } from '../../theme'
import { OTHER_COLOR, rowColor, type CategoryLeaf, type CategoryRow } from './categoryReport'
import { feedLink, type ReportFilters } from './reportFilters'
import { formatShare } from './reportPeriod'
import classes from './ReportsPage.module.css'

/**
 * Таблица отчёта по категориям — полный текстовый эквивалент кольца: все категории (без
 * «Прочего»), сумма и доля от общего итога, подкатегории раскрываются. Название — ссылка
 * в ленту с этой категорией за тот же период, счета и участника; так в ленту попадают
 * и с клавиатуры.
 *
 * Собственные операции родителя (записанные прямо в него) — строка «Без подкатегории»,
 * без ссылки: лента не умеет показать родителя без подкатегорий, а ссылка на родителя
 * показала бы другую сумму.
 */
// Роли ARIA повторяют родные: при узком блоке строки перестраиваются через display (CSS),
// а смена display у элементов таблицы в части браузеров стирает её смысл для диктора.
export function CategoryTable({
  rows,
  total,
  currency,
  filters,
  caption,
  highlighted,
}: {
  rows: CategoryRow[]
  total: number
  currency: string
  filters: ReportFilters
  /** Подпись таблицы для диктора: «Расходы по категориям, Ноябрь 2026». */
  caption: string
  /** Категория, на сегмент которой навели в кольце. */
  highlighted: string | null
}) {
  const t = useT()
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const name = (item: { name: string | null; archived: boolean }) => {
    const text = item.name ?? t.feed.filters.unknownCategory
    return item.archived ? t.feed.filters.archived(text) : text
  }

  return (
    <table className={classes.table} role="table">
      <caption className={classes.visuallyHidden}>{caption}</caption>
      <thead className={classes.visuallyHidden} role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader">
            {t.reports.table.category}
          </th>
          <th scope="col" role="columnheader">
            {t.reports.table.amount}
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row, index) => {
          const color = rowColor(index, rows.length)
          const open = expanded.has(row.id)
          return (
            <Fragment key={row.id}>
              <tr
                role="row"
                className={classes.row}
                data-highlight={highlighted === row.id || undefined}
              >
                <th scope="row" role="rowheader" className={classes.nameCell}>
                  <div className={classes.nameLine}>
                    {row.children.length > 0 ? (
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="lg"
                        className={classes.expand}
                        data-open={open || undefined}
                        aria-expanded={open}
                        aria-label={t.reports.table.expand(name(row))}
                        onClick={() => toggle(row.id)}
                      >
                        <IconChevronRight size={icons.size.md} stroke={icons.stroke} />
                      </ActionIcon>
                    ) : (
                      <span className={classes.expandSpacer} />
                    )}
                    <span
                      className={classes.swatch}
                      style={{
                        backgroundColor:
                          color === OTHER_COLOR ? chartColors.other : chartColors.series[color],
                      }}
                      aria-hidden
                    />
                    <Link to={feedLink(filters, row.id)} className={classes.nameLink}>
                      <span className={classes.nameClamp}>{name(row)}</span>
                    </Link>
                  </div>
                </th>
                <AmountCell amount={row.amount} total={total} currency={currency} />
              </tr>
              {open &&
                row.children.map((leaf) => (
                  <LeafRow
                    key={leaf.own ? `${leaf.id}:own` : leaf.id}
                    leaf={leaf}
                    label={leaf.own ? t.reports.table.own : name(leaf)}
                    href={leaf.own ? null : feedLink(filters, leaf.id)}
                    total={total}
                    currency={currency}
                  />
                ))}
            </Fragment>
          )
        })}
      </tbody>
      <tfoot role="rowgroup">
        <tr role="row" className={classes.totalRow}>
          <th scope="row" role="rowheader" className={classes.nameCell}>
            <div className={classes.nameLine}>
              <span className={classes.expandSpacer} />
              <Text component="span" fw={600}>
                {t.reports.table.total}
              </Text>
            </div>
          </th>
          <AmountCell amount={total} total={total} currency={currency} strong />
        </tr>
      </tfoot>
    </table>
  )
}

function LeafRow({
  leaf,
  label,
  href,
  total,
  currency,
}: {
  leaf: CategoryLeaf
  label: string
  href: string | null
  total: number
  currency: string
}) {
  return (
    <tr role="row" className={classes.row} data-level="1">
      <th scope="row" role="rowheader" className={classes.nameCell}>
        <div className={classes.nameLine}>
          <span className={classes.expandSpacer} />
          {href ? (
            <Link to={href} className={classes.nameLink}>
              <span className={classes.nameClamp}>{label}</span>
            </Link>
          ) : (
            <span className={classes.nameText}>
              <span className={classes.nameClamp}>{label}</span>
            </span>
          )}
        </div>
      </th>
      <AmountCell amount={leaf.amount} total={total} currency={currency} />
    </tr>
  )
}

/** Сумма (до рублей, ux.md раздел 2) и под ней доля от общего итога. */
function AmountCell({
  amount,
  total,
  currency,
  strong,
}: {
  amount: number
  total: number
  currency: string
  strong?: boolean
}) {
  const t = useT()
  return (
    <td role="cell" className={classes.amountCell}>
      <Money
        amount={amount}
        currency={currency}
        roundToMajor
        wrap
        fw={strong ? 600 : 500}
        component="div"
      />
      <Text size="sm" c="dimmed">
        {formatShare(amount, total, t)}
      </Text>
    </td>
  )
}
