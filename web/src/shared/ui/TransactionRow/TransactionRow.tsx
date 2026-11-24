import { Text, UnstyledButton } from '@mantine/core'
import {
  IconArrowDownLeft,
  IconArrowsRightLeft,
  IconArrowUpRight,
  IconScale,
  type Icon,
} from '@tabler/icons-react'
import type { ReactNode } from 'react'

import type { Category, Transaction, TransactionKind } from '../../api'
import { useT } from '../../i18n'
import { CATEGORY_PATH_SEPARATOR } from '../../lib/categoryTree'
import { Money } from '../Money/Money'
import { icons } from '../../../theme'
import { describeTransaction } from './describeTransaction'
import classes from './TransactionRow.module.css'

export type TransactionRowProps = {
  transaction: Transaction
  /** Названия счетов по id — все, включая архивные: старая операция может быть на архивном. */
  accountNames: ReadonlyMap<string, string>
  /** Категории по id — все, включая архивные (у подкатегории нужен родитель). */
  categories: ReadonlyMap<string, Category>
  /** Показать автора — только если в семье больше одного человека (ux.md, «Лента»). */
  showAuthor?: boolean
  /** Действия справа (меню «⋯»). */
  actions?: ReactNode
  /**
   * Строка активируется (клик, Enter, пробел) — открыть операцию. Вся строка, кроме
   * действий справа, становится кнопкой.
   */
  onActivate?: () => void
  /** Операция раскрыта в форму на месте (desktop) — `aria-expanded` у кнопки строки. */
  expanded?: boolean
}

/** Атрибут кнопки строки (значение — id операции): по нему экран ставит фокус. */
export const ROW_BUTTON = 'data-transaction-open'

// Иконка вида операции: у категорий нет своих иконок и цветов, а вид помогает глазу
// отличить перевод и корректировку от расходов. Декоративна — смысл есть в тексте и знаке.
const kindIcons: Record<TransactionKind, Icon> = {
  expense: IconArrowUpRight,
  income: IconArrowDownLeft,
  transfer: IconArrowsRightLeft,
  adjustment: IconScale,
}

/**
 * Строка операции в ленте (ux.md, «Лента операций»): иконка вида · категория
 * и комментарий · сумма и счёт мелко.
 *
 * - Расход — «−590 ₽» обычным цветом, доход — «+590 ₽» зелёным; перевод — без знака,
 *   «Карта → Наличные», у обмена валют — обе суммы. Корректировка — сумма со знаком как есть.
 * - Подкатегория — с приглушённым родителем («Продукты › Молочное»), как в выборе категории:
 *   глаз находит само название, а родитель не теряется.
 * - Перевод с чужим личным счётом: «Пополнение: Иван» / «Снятие: Иван» (requirements, раздел 4).
 * - Длинные названия обрезаются многоточием (ux.md, раздел 4: плотная строка); огромная
 *   сумма переносится под название, а при крупном шрифте строка перестраивается в столбик.
 *
 * Данные не загружает: названия счетов и категорий — пропсами.
 */
export function TransactionRow({
  transaction,
  accountNames,
  categories,
  showAuthor = false,
  actions,
  onActivate,
  expanded,
}: TransactionRowProps) {
  const t = useT()
  const view = describeTransaction(transaction, { accountNames, categories }, t)
  const KindIcon = kindIcons[transaction.kind]
  const author = showAuthor ? (transaction.author?.name ?? t.feed.row.deletedAuthor) : null
  const secondary = [author, transaction.comment].filter(Boolean).join(' · ')

  const content = (
    <>
      {/* Не ThemeIcon: внутри кнопки допустимы только строчные элементы, а он — div. */}
      <span aria-hidden className={classes.icon}>
        <KindIcon size={icons.size.md} stroke={icons.stroke} />
      </span>
      <span className={classes.body}>
        <span className={classes.main}>
          <Text component="span" display="block" fw={500} truncate="end">
            {view.title.parent !== null && (
              <span className={classes.parent}>
                {view.title.parent}
                {CATEGORY_PATH_SEPARATOR}
              </span>
            )}
            {view.title.name}
          </Text>
          {secondary && (
            <Text component="span" display="block" size="sm" c="dimmed" truncate="end">
              {secondary}
            </Text>
          )}
        </span>
        <span className={classes.side}>
          {view.amount && (
            <Money
              amount={view.amount.value}
              currency={view.amount.currency}
              variant={view.amount.flow ? 'flow' : 'plain'}
              component="span"
              fw={500}
              wrap
              className={classes.amount}
            />
          )}
          {view.side && (
            <Text component="span" display="block" size="xs" c="dimmed" className={classes.meta}>
              {view.side.type === 'account' ? (
                view.side.name
              ) : (
                <>
                  {'→ '}
                  <Money amount={view.side.value} currency={view.side.currency} />
                </>
              )}
            </Text>
          )}
        </span>
      </span>
    </>
  )

  return (
    <div className={classes.row} data-transaction-row={transaction.id}>
      {onActivate ? (
        <UnstyledButton
          className={classes.activate}
          onClick={onActivate}
          aria-expanded={expanded}
          {...{ [ROW_BUTTON]: transaction.id }}
        >
          {content}
        </UnstyledButton>
      ) : (
        <div className={classes.static}>{content}</div>
      )}
      {actions && <div className={classes.actions}>{actions}</div>}
    </div>
  )
}
