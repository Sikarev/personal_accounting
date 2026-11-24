import { ActionIcon, Menu } from '@mantine/core'
import { IconCopy, IconDots, IconPencil, IconTrash } from '@tabler/icons-react'
import { memo, useId, useRef, type ReactNode } from 'react'

import type { Category, Transaction } from '../../shared/api'
import { useT } from '../../shared/i18n'
import type { DayGroup } from '../../shared/lib/transactionFeed'
import { TransactionDayHeader, TransactionRow, transactionTitle } from '../../shared/ui'
import { icons } from '../../theme'
import { ROW_MENU } from './focusTargets'
import { canDelete, canDuplicate } from './useTransactionActions'
import classes from './TransactionDays.module.css'

/** Что сделать с операцией из строки списка. */
export type RowAction = 'open' | 'duplicate' | 'delete'

export type TransactionDaysProps = {
  groups: DayGroup[]
  today: string
  accountNames: ReadonlyMap<string, string>
  categories: ReadonlyMap<string, Category>
  showAuthor: boolean
  onAction: (action: RowAction, transaction: Transaction) => void
  /** Операция, раскрытая в форму правки на месте (лента на desktop), и сама форма. */
  editing?: { id: string; form: ReactNode } | null
  /** Строка открывает окно правки, а не форму на месте. */
  opensDialog: boolean
  /**
   * Уровень заголовков дней: 2 — прямо под заголовком экрана (лента), 3 — внутри блока
   * со своим заголовком (последние операции на главной).
   */
  headingOrder?: 2 | 3
}

/**
 * Операции по дням: заголовок дня с итогом и строки с меню «Изменить / Дублировать /
 * Удалить». Общие для ленты «Операции» и последних операций на главной.
 *
 * Мемоизированы: в ленте при вводе в поиск адрес меняется на каждую букву, а список
 * перерисовывается, только когда пришли данные.
 */
export const TransactionDays = memo(function TransactionDays({
  groups,
  ...rest
}: TransactionDaysProps) {
  return (
    <div className={classes.days}>
      {groups.map((group) => (
        <DaySection key={group.date} group={group} {...rest} />
      ))}
    </div>
  )
})

// Группы пересобираются при каждом изменении списка (подгрузка, удаление), но объекты
// операций из кэша те же — поэтому строки мемоизированы по операции, а не по группе.
const DaySection = memo(function DaySection({
  group,
  today,
  editing,
  headingOrder,
  ...rowProps
}: Omit<TransactionDaysProps, 'groups'> & { group: DayGroup }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <TransactionDayHeader
        id={headingId}
        date={group.date}
        today={today}
        totals={group.totals}
        headingOrder={headingOrder}
      />
      <ul className={classes.rows}>
        {group.items.map((transaction) => (
          <li key={transaction.id}>
            {editing?.id === transaction.id ? (
              editing.form
            ) : (
              <DayRow transaction={transaction} {...rowProps} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
})

/** Строка с меню; перерисовывается, только если изменилась сама операция или справочники. */
const DayRow = memo(function DayRow({
  transaction,
  accountNames,
  categories,
  showAuthor,
  onAction,
  opensDialog,
}: Omit<TransactionDaysProps, 'groups' | 'today' | 'editing' | 'headingOrder'> & {
  transaction: Transaction
}) {
  const t = useT()
  return (
    <TransactionRow
      transaction={transaction}
      accountNames={accountNames}
      categories={categories}
      showAuthor={showAuthor}
      onActivate={() => onAction('open', transaction)}
      opensDialog={opensDialog}
      actions={
        <RowMenu
          transaction={transaction}
          title={transactionTitle(transaction, { accountNames, categories }, t)}
          onAction={onAction}
        />
      }
    />
  )
})

/**
 * Меню строки: «Изменить» (то же, что касание строки), «Дублировать» — кроме корректировки
 * и перевода со скрытым чужим счётом, «Удалить» — если видны все счета операции (`editable`)
 * или это корректировка.
 */
function RowMenu({
  transaction,
  title,
  onAction,
}: {
  transaction: Transaction
  title: string
  onAction: TransactionDaysProps['onAction']
}) {
  const t = useT()
  const icon = (I: typeof IconPencil) => <I size={icons.size.md} stroke={icons.stroke} />
  // Действие выполняется, когда меню закрылось совсем и вернуло фокус на свою кнопку:
  // иначе окно, открытое из пункта меню (окно правки), запомнило бы для возврата
  // исчезающий пункт — и после закрытия окна фокус ушёл бы на `body`.
  const pending = useRef<RowAction | null>(null)
  const later = (action: RowAction) => () => {
    pending.current = action
  }
  return (
    // Без портала: меню остаётся внутри <main> (axe: всё содержимое — в ориентирах).
    <Menu
      position="bottom-end"
      withinPortal={false}
      transitionProps={{
        onExited: () => {
          const action = pending.current
          pending.current = null
          if (action) onAction(action, transaction)
        },
      }}
    >
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          radius="xl"
          className={classes.menuButton}
          aria-label={t.feed.row.actions(title)}
          {...{ [ROW_MENU]: transaction.id }}
        >
          <IconDots size={icons.size.md} stroke={icons.stroke} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={icon(IconPencil)} onClick={later('open')}>
          {t.feed.actions.edit}
        </Menu.Item>
        {canDuplicate(transaction) && (
          <Menu.Item leftSection={icon(IconCopy)} onClick={later('duplicate')}>
            {t.feed.actions.duplicate}
          </Menu.Item>
        )}
        {canDelete(transaction) && (
          <Menu.Item
            // Цвет «проблемы» из темы: у color="red" в меню контраст ниже AA.
            className={classes.danger}
            leftSection={icon(IconTrash)}
            onClick={later('delete')}
          >
            {t.feed.actions.delete}
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  )
}
