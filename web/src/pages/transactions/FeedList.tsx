import { ActionIcon, Button, Menu, Paper, Text } from '@mantine/core'
import { IconCopy, IconDots, IconPencil, IconTrash } from '@tabler/icons-react'
import { memo, useEffect, useId, useState, type ReactNode } from 'react'

import type { Category, Transaction } from '../../shared/api'
import { useT } from '../../shared/i18n'
import type { DayGroup } from '../../shared/lib/transactionFeed'
import {
  TransactionDayHeader,
  TransactionListSkeleton,
  TransactionRow,
  transactionTitle,
} from '../../shared/ui'
import { icons } from '../../theme'
import { ROW_MENU } from './focusTargets'
import { canDelete, canDuplicate } from './useTransactionActions'
import classes from './TransactionsPage.module.css'

/** Что сделать с операцией из строки ленты. */
export type RowAction = 'open' | 'duplicate' | 'delete'

type FeedListProps = {
  groups: DayGroup[]
  today: string
  accountNames: ReadonlyMap<string, string>
  categories: ReadonlyMap<string, Category>
  showAuthor: boolean
  onAction: (action: RowAction, transaction: Transaction) => void
  /** Операция, раскрытая в форму правки на месте (desktop), и сама форма. */
  editing: { id: string; form: ReactNode } | null
}

/**
 * Лента по дням: заголовок дня с итогом и строки операций. Мемоизирована: при вводе в поиск
 * адрес меняется на каждую букву, а список перерисовывается, только когда пришли данные.
 */
export const FeedList = memo(function FeedList({ groups, ...rest }: FeedListProps) {
  return (
    <div className={classes.days}>
      {groups.map((group) => (
        <DaySection key={group.date} group={group} {...rest} />
      ))}
    </div>
  )
})

// Группы пересобираются при каждом изменении ленты (подгрузка, удаление), но объекты
// операций из кэша те же — поэтому строки мемоизированы по операции, а не по группе.
const DaySection = memo(function DaySection({
  group,
  today,
  editing,
  ...rowProps
}: Omit<FeedListProps, 'groups'> & { group: DayGroup }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <TransactionDayHeader id={headingId} date={group.date} today={today} totals={group.totals} />
      <ul className={classes.rows}>
        {group.items.map((transaction) => (
          <li key={transaction.id}>
            {editing?.id === transaction.id ? (
              editing.form
            ) : (
              <FeedRow transaction={transaction} {...rowProps} />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
})

/** Строка ленты с меню; перерисовывается, только если изменилась сама операция или справочники. */
const FeedRow = memo(function FeedRow({
  transaction,
  accountNames,
  categories,
  showAuthor,
  onAction,
}: Omit<FeedListProps, 'groups' | 'today' | 'editing'> & { transaction: Transaction }) {
  const t = useT()
  return (
    <TransactionRow
      transaction={transaction}
      accountNames={accountNames}
      categories={categories}
      showAuthor={showAuthor}
      onActivate={() => onAction('open', transaction)}
      expanded={false}
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
  onAction: FeedListProps['onAction']
}) {
  const t = useT()
  const icon = (I: typeof IconPencil) => <I size={icons.size.md} stroke={icons.stroke} />
  return (
    // Без портала: меню остаётся внутри <main> (axe: всё содержимое — в ориентирах).
    <Menu position="bottom-end" withinPortal={false}>
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
        <Menu.Item leftSection={icon(IconPencil)} onClick={() => onAction('open', transaction)}>
          {t.feed.actions.edit}
        </Menu.Item>
        {canDuplicate(transaction) && (
          <Menu.Item
            leftSection={icon(IconCopy)}
            onClick={() => onAction('duplicate', transaction)}
          >
            {t.feed.actions.duplicate}
          </Menu.Item>
        )}
        {canDelete(transaction) && (
          <Menu.Item
            // Цвет «проблемы» из темы: у color="red" в меню контраст ниже AA.
            className={classes.danger}
            leftSection={icon(IconTrash)}
            onClick={() => onAction('delete', transaction)}
          >
            {t.feed.actions.delete}
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>
  )
}

type LoadMoreProps = {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  /** Следующую страницу загрузить не удалось. */
  isNextPageError: boolean
  /** Лента сейчас перезапрашивается целиком — подгружать следующую страницу рано. */
  isRefetching: boolean
  /** Число загруженных страниц: после каждой наблюдатель проверяет конец списка заново. */
  pageCount: number
  fetchNextPage: () => unknown
}

/**
 * Подгрузка при прокрутке (requirements 5.8): `IntersectionObserver` следит за концом
 * списка и подгружает следующую страницу заранее, за экран до конца. Кнопка «Показать ещё» —
 * запасной путь для клавиатуры и браузера без наблюдателя. Ошибка следующей страницы —
 * строка с «Повторить» под списком: загруженное не пропадает, сама подгрузка не повторяется
 * в цикле.
 */
export function LoadMore({
  hasNextPage,
  isFetchingNextPage,
  isNextPageError,
  isRefetching,
  pageCount,
  fetchNextPage,
}: LoadMoreProps) {
  const t = useT()
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null)
  const autoLoad = hasNextPage && !isFetchingNextPage && !isNextPageError && !isRefetching

  useEffect(() => {
    if (!sentinel || !autoLoad || typeof IntersectionObserver === 'undefined') return
    // Новый наблюдатель сразу сообщает текущее пересечение: если после загрузки страницы
    // конец списка всё ещё на экране (короткие страницы), подгрузится следующая.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void fetchNextPage()
      },
      { rootMargin: '0px 0px 100% 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [sentinel, autoLoad, pageCount, fetchNextPage])

  if (!hasNextPage) return null
  return (
    <div ref={setSentinel} className={classes.loadMore}>
      {isNextPageError ? (
        <Paper withBorder radius="lg" p="md" className={classes.inlineError} role="alert">
          <Text size="sm">{t.feed.nextPageError}</Text>
          <Button
            variant="default"
            size="md"
            className={classes.touchButton}
            onClick={() => void fetchNextPage()}
          >
            {t.errors.retry}
          </Button>
        </Paper>
      ) : (
        <>
          {isFetchingNextPage && <TransactionListSkeleton groups={1} rowsPerGroup={2} />}
          {/* Без loading: отключённая кнопка потеряла бы фокус клавиатуры. */}
          <Button
            variant="default"
            size="md"
            className={classes.touchButton}
            onClick={() => {
              if (!isFetchingNextPage) void fetchNextPage()
            }}
          >
            {t.feed.showMore}
          </Button>
        </>
      )}
    </div>
  )
}
