import { Button, Paper, Title } from '@mantine/core'
import { IconChevronRight, IconListDetails, IconPlus } from '@tabler/icons-react'
import { useCallback, useEffect, useId, useMemo, useRef } from 'react'
import { Link } from 'react-router'

import { paths } from '../../app/navigation'
import { useToday } from '../../features/auth/session'
import { useQuickAdd } from '../../features/quick-add/quickAddContext'
import { EditTransactionSheet } from '../../features/transactions/EditTransactionSheet'
import { rowButtonSelector } from '../../features/transactions/focusTargets'
import { TransactionDays, type RowAction } from '../../features/transactions/TransactionDays'
import { useEditSheet } from '../../features/transactions/useEditSheet'
import { useTransactionActions } from '../../features/transactions/useTransactionActions'
import type { Account, Category, Transaction, TransactionList } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { groupByDay, mergeDays } from '../../shared/lib/transactionFeed'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import { usePendingFocus } from '../../shared/lib/usePendingFocus'
import { EmptyState, TransactionListSkeleton, transactionTitle } from '../../shared/ui'
import { icons } from '../../theme'
import { BlockError } from './BlockError'
import { focusHomeForm, HOME_PRIMARY_ACTION, RECENT_ALL_LINK } from './focusTargets'
import classes from './HomePage.module.css'

type Query<T> = {
  data: T | undefined
  isPending: boolean
  isError: boolean
  isFetching: boolean
  error: unknown
  refetch: () => unknown
}

type RecentTransactionsProps = {
  /** `GET /transactions?limit=10` — запрос на уровне экрана, параллельно со счетами и чанком. */
  query: Query<TransactionList>
  /** Категории — названия в строках. */
  categoriesQuery: Query<{ items: Category[] }>
  /** Счета (все, в т. ч. архивные: операция может быть на архивном). */
  accounts: readonly Account[]
  /** Показать автора — в семье больше одного человека. */
  showAuthor: boolean
  /** Раскладка mobile: пустое состояние ведёт в окно быстрого ввода, а не к форме рядом. */
  mobile: boolean
}

/**
 * Последние 10 операций по дням с итогом дня (как в ленте) и ссылка «Все операции».
 * Касание строки — окно правки (inline-правки здесь нет: рядом и так форма), меню строки —
 * «Изменить / Дублировать / Удалить», удаление — сразу, с «Отменить» в тосте.
 */
export function RecentTransactions({
  query,
  categoriesQuery,
  accounts,
  showAuthor,
  mobile,
}: RecentTransactionsProps) {
  const t = useT()
  const today = useToday()
  const quickAdd = useQuickAdd()
  const actions = useTransactionActions()
  const sheet = useEditSheet()
  const headingId = useId()

  const items = useMemo(() => query.data?.items ?? [], [query.data])
  const groups = useMemo(
    () => (query.data ? groupByDay(items, mergeDays([query.data])) : []),
    [items, query.data],
  )
  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])
  const categories = useMemo(
    () => new Map((categoriesQuery.data?.items ?? []).map((c) => [c.id, c])),
    [categoriesQuery.data],
  )

  // Удалённая строка исчезает вместе с кнопкой, на которой был фокус: фокус — на соседнюю
  // строку, иначе на главное действие пустого блока или «Все операции». Ставится, когда
  // строка уже ушла с экрана.
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  })
  const focusWhenReady = usePendingFocus()

  // Обработчики строк постоянные (строки мемоизированы); свежие данные — из ref.
  const latest = useRef({ actions, quickAdd, sheet })
  useEffect(() => {
    latest.current = { actions, quickAdd, sheet }
  })

  const remove = useCallback(
    (transaction: Transaction) => {
      const list = itemsRef.current
      const index = list.findIndex((item) => item.id === transaction.id)
      const neighbors = [list[index + 1], list[index - 1]].filter(Boolean)
      focusWhenReady(
        () => !itemsRef.current.some((item) => item.id === transaction.id),
        [
          ...neighbors.map((n) => rowButtonSelector(n.id)),
          `[${HOME_PRIMARY_ACTION}]`,
          `[${RECENT_ALL_LINK}]`,
        ],
      )
      void latest.current.actions.remove(transaction)
    },
    [focusWhenReady],
  )

  const onAction = useCallback(
    (action: RowAction, transaction: Transaction) => {
      if (action === 'delete') return remove(transaction)
      if (action === 'duplicate') {
        // Пункт меню к закрытию окна быстрого ввода уже исчез — фокус вернётся на строку.
        return latest.current.quickAdd.open(transaction, {
          returnFocus: () =>
            document.querySelector<HTMLElement>(rowButtonSelector(transaction.id))?.focus(),
        })
      }
      latest.current.sheet.open(transaction.id)
    },
    [remove],
  )

  const isPending = query.isPending || categoriesQuery.isPending
  const showSkeleton = useDelayedLoading(isPending)
  const failed = [query, categoriesQuery].filter((q) => q.isError && !q.data)
  const sheetTransaction = sheet.editingId
    ? items.find((item) => item.id === sheet.editingId)
    : undefined

  let content
  if (failed.length > 0) {
    content = (
      <BlockError
        title={t.home.recentLoadError}
        error={failed[0].error}
        retrying={failed.some((q) => q.isFetching)}
        onRetry={() => failed.forEach((q) => void q.refetch())}
      />
    )
  } else if (isPending) {
    content = showSkeleton ? <TransactionListSkeleton groups={2} rowsPerGroup={2} /> : null
  } else if (items.length === 0) {
    content = (
      <Paper withBorder radius="lg">
        <EmptyState
          icon={IconListDetails}
          titleOrder={3}
          title={t.home.emptyTitle}
          description={mobile ? t.home.emptyDescriptionMobile : t.home.emptyDescriptionDesktop}
          action={
            mobile ? (
              <Button
                variant="light"
                size="md"
                leftSection={<IconPlus size={icons.size.md} stroke={icons.stroke} />}
                onClick={() => quickAdd.open()}
                aria-haspopup="dialog"
                {...{ [HOME_PRIMARY_ACTION]: true }}
              >
                {t.nav.addTransaction}
              </Button>
            ) : (
              <Button
                variant="light"
                size="md"
                onClick={focusHomeForm}
                {...{ [HOME_PRIMARY_ACTION]: true }}
              >
                {t.home.focusForm}
              </Button>
            )
          }
        />
      </Paper>
    )
  } else {
    content = (
      <TransactionDays
        groups={groups}
        today={today}
        accountNames={accountNames}
        categories={categories}
        showAuthor={showAuthor}
        onAction={onAction}
        opensDialog
        headingOrder={3}
      />
    )
  }

  return (
    <section aria-labelledby={headingId} className={classes.recent}>
      <div className={classes.blockHeader}>
        <Title id={headingId} order={2} size="lg">
          {t.home.recentTitle}
        </Title>
        {items.length > 0 && (
          <Button
            component={Link}
            to={paths.transactions}
            variant="subtle"
            size="md"
            className={classes.touchButton}
            rightSection={<IconChevronRight size={icons.size.md} stroke={icons.stroke} />}
            {...{ [RECENT_ALL_LINK]: true }}
          >
            {t.home.allTransactions}
          </Button>
        )}
      </div>
      {content}
      <EditTransactionSheet
        sheet={sheet}
        transaction={sheetTransaction}
        title={
          sheetTransaction
            ? transactionTitle(sheetTransaction, { accountNames, categories }, t)
            : ''
        }
        onEdited={actions.edited}
        onDelete={remove}
      />
    </section>
  )
}
