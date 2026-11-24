import { Button, Paper, VisuallyHidden } from '@mantine/core'
import { IconAlertCircle, IconListDetails, IconPlus, IconSearch } from '@tabler/icons-react'
import { keepPreviousData } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { useToday } from '../../features/auth/session'
import { useQuickAdd } from '../../features/quick-add/quickAddContext'
import {
  apiErrorText,
  useGetMe,
  useGetTransactionsSummary,
  useListAccounts,
  useListCategories,
  useListTransactionsInfinite,
  type Transaction,
} from '../../shared/api'
import { useT } from '../../shared/i18n'
import { formatCount } from '../../shared/lib/plural'
import { groupByDay, mergeDays } from '../../shared/lib/transactionFeed'
import {
  EMPTY_FILTERS,
  filtersToSearchParams,
  hasActiveFilters,
  parseFilters,
  toListParams,
  type FeedFilters,
} from '../../shared/lib/transactionFilters'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import { useMobileLayout } from '../../shared/lib/useMobileLayout'
import { usePendingFocus } from '../../shared/lib/usePendingFocus'
import { EmptyState, PageHeader, TransactionListSkeleton, transactionTitle } from '../../shared/ui'
import { icons } from '../../theme'
import { EditTransaction, INLINE_EDIT } from '../../features/transactions/EditTransaction'
import { EditTransactionSheet } from '../../features/transactions/EditTransactionSheet'
import { rowButtonSelector } from '../../features/transactions/focusTargets'
import { TransactionDays, type RowAction } from '../../features/transactions/TransactionDays'
import type { TransactionFormState } from '../../features/transactions/TransactionFormView'
import { useEditSheet } from '../../features/transactions/useEditSheet'
import { useTransactionActions } from '../../features/transactions/useTransactionActions'
import { ActiveFilterChips, FeedFilterBar, type SearchState, type SetFilters } from './FeedFilters'
import { FeedSummary } from './FeedSummary'
import { activeFilterChips } from './filterOptions'
import { SEARCH_FIELD } from './focusTargets'
import { LoadMore } from './LoadMore'
import classes from './TransactionsPage.module.css'

/**
 * Фильтры — в адресе страницы (`?from=…&kind=…`). Меняются с `replace`: фильтр — это вид
 * ленты, а не переход, и «Назад» уводит с экрана, а не перебирает буквы поиска.
 */
function useFeedFilters(): [FeedFilters, SetFilters] {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => parseFilters(searchParams), [searchParams])
  const setFilters = useCallback<SetFilters>(
    (patch) =>
      setSearchParams((prev) => filtersToSearchParams({ ...parseFilters(prev), ...patch }), {
        replace: true,
      }),
    [setSearchParams],
  )
  return [filters, setFilters]
}

/**
 * Экран «Операции» (requirements 5.8): лента по дням с итогом дня, фильтры в адресе,
 * итоги выборки, подгрузка при прокрутке, удаление с отменой.
 */
export function TransactionsPage() {
  const t = useT()
  const today = useToday()
  const quickAdd = useQuickAdd()
  const [filters, setUrlFilters] = useFeedFilters()
  const filtered = hasActiveFilters(filters)
  const params = useMemo(() => toListParams(filters), [filters])

  // Поиск печатается в поле и уходит в адрес с задержкой (FeedFilters → SearchField).
  // Если поиск меняется не из поля — чип, «Сбросить», переход по меню «Операции» или
  // «Назад», — поле пересоздаётся (`epoch`) со значением из адреса, иначе в поле осталось бы
  // «кофе» при ленте без поиска. `written` — что поле записало в адрес само: адрес
  // обновляется не мгновенно, и его отставание от поля — не «изменение снаружи».
  const [search, setSearch] = useState<SearchState>({ epoch: 0, value: filters.q })
  const [written, setWritten] = useState(filters.q)
  const [urlQ, setUrlQ] = useState(filters.q)
  if (filters.q !== urlQ) {
    setUrlQ(filters.q)
    if (filters.q !== written) {
      setWritten(filters.q)
      setSearch((s) => ({ epoch: s.epoch + 1, value: filters.q }))
    }
  }
  const onSearch = useCallback<SetFilters>(
    (patch) => {
      if (patch.q !== undefined) setWritten(patch.q)
      setUrlFilters(patch)
    },
    [setUrlFilters],
  )
  const setFilters = useCallback<SetFilters>(
    (patch) => {
      if (patch.q !== undefined) {
        const value = patch.q
        setWritten(value)
        setSearch((s) => ({ epoch: s.epoch + 1, value }))
      }
      setUrlFilters(patch)
    },
    [setUrlFilters],
  )

  const feed = useListTransactionsInfinite(params, {
    query: {
      initialPageParam: undefined,
      getNextPageParam: (last) => last.nextCursor,
      // Пока грузится лента с новым фильтром, на экране остаётся прежняя — без мигания.
      placeholderData: keepPreviousData,
    },
  })
  const summary = useGetTransactionsSummary(params, {
    query: { placeholderData: keepPreviousData },
  })
  const accountsQuery = useListAccounts()
  const categoriesQuery = useListCategories()
  const me = useGetMe()
  const actions = useTransactionActions()

  // Архивные счета и категории тоже: старая операция может быть на архивном счёте.
  const accounts = useMemo(() => accountsQuery.data?.items ?? [], [accountsQuery.data])
  const categoryList = useMemo(() => categoriesQuery.data?.items ?? [], [categoriesQuery.data])
  const accountNames = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts])
  const categories = useMemo(() => new Map(categoryList.map((c) => [c.id, c])), [categoryList])
  const showAuthor = (me.data?.family.memberCount ?? 1) > 1

  const pages = feed.data?.pages
  const items = useMemo(() => pages?.flatMap((p) => p.items) ?? [], [pages])
  const groups = useMemo(() => groupByDay(items, mergeDays(pages ?? [])), [items, pages])

  const chips = activeFilterChips(filters, { accountNames, categories, today }, t)

  // ——— Объявления для экранного диктора ———
  // Лента меняется без перехода: после смены фильтра — «Лента обновлена», после подгрузки —
  // «Загружено ещё N». Первая загрузка не объявляется: её видно по самому экрану.
  // Считается при рендере по готовым данным (не по `placeholderData` прежнего фильтра).
  const pageCount = pages?.length ?? 0
  const loadedKey = feed.data && !feed.isPlaceholderData ? JSON.stringify(params) : null
  const [announced, setAnnounced] = useState({ key: loadedKey, pages: pageCount, message: '' })
  if (loadedKey !== null && (loadedKey !== announced.key || pageCount !== announced.pages)) {
    let message = announced.message
    if (announced.key !== null && loadedKey !== announced.key) {
      message = t.feed.updated
    } else if (loadedKey === announced.key && pageCount > announced.pages) {
      message = t.feed.loadedMore(formatCount(pages!.at(-1)!.items.length, t.feed.operations))
    }
    setAnnounced({ key: loadedKey, pages: pageCount, message })
  }

  // ——— Фокус ———
  // Элемент с фокусом может исчезнуть: удалённая строка (с кнопкой меню), закрытая форма
  // правки на месте строки. Фокус ставим, когда изменение уже на экране, — иначе он ушёл бы
  // вместе с элементом на `body`. `ready` — «изменение отрисовано».
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  })
  // После эффекта выше: `ready` читает уже обновлённый itemsRef.
  const focusWhenReady = usePendingFocus()

  // ——— Правка ———
  // Desktop — форма на месте строки (одна за раз), mobile — окно. Вид выбирается в момент
  // открытия (как у ResponsiveSheet) и не меняется, пока правка открыта.
  const mobile = useMobileLayout()
  const [inlineId, setInlineId] = useState<string | null>(null)
  const sheet = useEditSheet()
  const inlineTransaction = inlineId ? items.find((item) => item.id === inlineId) : undefined
  const sheetTransaction = sheet.editingId
    ? items.find((item) => item.id === sheet.editingId)
    : undefined

  const focusRow = useCallback(
    (id: string) =>
      focusWhenReady(
        () => document.querySelector(rowButtonSelector(id)) !== null,
        [rowButtonSelector(id)],
      ),
    [focusWhenReady],
  )

  // Обработчики строк — постоянные: иначе мемоизированный список перерисовывался бы
  // на каждую букву поиска. Свежие данные они берут из ref.
  const latest = useRef({ actions, mobile, quickAdd, inlineId, sheet })
  useEffect(() => {
    latest.current = { actions, mobile, quickAdd, inlineId, sheet }
  })

  // Отправляется ли открытая форма и есть ли в ней несохранённые изменения: пока да,
  // другая строка не открывается (решение PM), а фокус возвращается в эту форму
  // с подсказкой «Сохраните или отмените изменения».
  const formState = useRef<TransactionFormState>({ submitting: false, dirty: false })
  const [editHint, setEditHint] = useState(false)
  const onFormState = useCallback((state: TransactionFormState) => {
    formState.current = state
    if (!state.dirty && !state.submitting) setEditHint(false)
  }, [])

  /**
   * Закрыть форму на месте строки `id` — только если открыта именно она: ответ сервера
   * на сохранение прежней формы не закрывает и не уводит фокус из другой.
   */
  const closeInline = useCallback(
    (id: string) => {
      if (latest.current.inlineId !== id) return
      setInlineId(null)
      setEditHint(false)
      formState.current = { submitting: false, dirty: false }
      focusRow(id)
    },
    [focusRow],
  )

  const remove = useCallback(
    (transaction: Transaction) => {
      const list = itemsRef.current
      const index = list.findIndex((item) => item.id === transaction.id)
      const neighbors = [list[index + 1], list[index - 1]].filter(Boolean)
      focusWhenReady(
        () => !itemsRef.current.some((item) => item.id === transaction.id),
        [...neighbors.map((n) => rowButtonSelector(n.id)), `[${SEARCH_FIELD}]`],
      )
      void latest.current.actions.remove(transaction)
    },
    [focusWhenReady],
  )

  const onAction = useCallback(
    (action: RowAction, transaction: Transaction) => {
      if (action === 'delete') {
        setInlineId((current) => (current === transaction.id ? null : current))
        return remove(transaction)
      }
      if (action === 'duplicate') {
        // Окно быстрого ввода вернуло бы фокус на кнопку, с которой его открыли, — пункт
        // меню или кнопку формы правки, а их к закрытию окна уже нет (фокус ушёл бы
        // на `body`). Цель возврата — строка операции.
        const focusRowButton = () =>
          document.querySelector<HTMLElement>(rowButtonSelector(transaction.id))?.focus()
        if (latest.current.inlineId === transaction.id) {
          setInlineId(null)
          setEditHint(false)
        }
        return latest.current.quickAdd.open(transaction, { returnFocus: focusRowButton })
      }
      const inline = !latest.current.mobile
      const current = latest.current.inlineId
      if (inline && current !== null && current !== transaction.id) {
        const { submitting, dirty } = formState.current
        if (submitting || dirty) {
          setEditHint(true)
          // В сумму — главное поле формы; рядом с кнопками формы — подсказка.
          const form = document.querySelector(`[${INLINE_EDIT}="${current}"]`)
          ;(
            form?.querySelector<HTMLElement>('input[inputmode="decimal"]') ??
            form?.querySelector<HTMLElement>('input, button')
          )?.focus()
          return
        }
      }
      formState.current = { submitting: false, dirty: false }
      setEditHint(false)
      if (inline) {
        setInlineId(transaction.id)
      } else {
        setInlineId(null)
        latest.current.sheet.open(transaction.id)
      }
    },
    [remove, setInlineId, setEditHint],
  )

  /** Сервер сохранил правку: строка — ответом сервера, тост; форму закрывает вызывающий. */
  const onEdited = (saved: Transaction) => actions.edited(saved)

  const inlineForm = inlineTransaction
    ? {
        id: inlineTransaction.id,
        form: (
          <EditTransaction
            inline
            transaction={inlineTransaction}
            title={transactionTitle(inlineTransaction, { accountNames, categories }, t)}
            onSaved={(saved) => {
              onEdited(saved)
              closeInline(inlineTransaction.id)
            }}
            onClose={() => closeInline(inlineTransaction.id)}
            onAction={onAction}
            onStateChange={onFormState}
            hint={editHint}
          />
        ),
      }
    : null

  const resetFilters = () => setFilters(EMPTY_FILTERS)

  const isPending = feed.isPending || accountsQuery.isPending || categoriesQuery.isPending
  const showSkeleton = useDelayedLoading(isPending)
  const failed = [feed, accountsQuery, categoriesQuery].filter((q) => q.isError && !q.data)

  let content
  if (failed.length > 0) {
    content = (
      <Paper withBorder radius="lg">
        <EmptyState
          icon={IconAlertCircle}
          title={t.feed.loadError}
          description={apiErrorText(failed[0].error, t)}
          action={
            <Button
              variant="default"
              size="md"
              className={classes.touchButton}
              loading={failed.some((q) => q.isFetching)}
              onClick={() => failed.forEach((q) => void q.refetch())}
            >
              {t.errors.retry}
            </Button>
          }
        />
      </Paper>
    )
  } else if (isPending) {
    content = showSkeleton ? <TransactionListSkeleton /> : null
  } else if (items.length === 0 && !feed.hasNextPage) {
    content = filtered ? (
      <Paper withBorder radius="lg">
        <EmptyState
          icon={IconSearch}
          title={t.feed.nothingFoundTitle}
          description={t.feed.nothingFoundDescription}
          action={
            <Button variant="default" size="md" onClick={resetFilters}>
              {t.feed.resetFilters}
            </Button>
          }
        />
      </Paper>
    ) : (
      <Paper withBorder radius="lg">
        <EmptyState
          icon={IconListDetails}
          title={t.feed.emptyTitle}
          description={t.feed.emptyDescription}
          action={
            <Button
              variant="light"
              size="md"
              leftSection={<IconPlus size={icons.size.md} stroke={icons.stroke} />}
              onClick={() => quickAdd.open()}
            >
              {t.nav.addTransaction}
            </Button>
          }
        />
      </Paper>
    )
  } else {
    content = (
      <>
        <TransactionDays
          groups={groups}
          today={today}
          accountNames={accountNames}
          categories={categories}
          showAuthor={showAuthor}
          onAction={onAction}
          editing={inlineForm}
          opensDialog={mobile}
        />
        <LoadMore
          hasNextPage={feed.hasNextPage}
          isFetchingNextPage={feed.isFetchingNextPage}
          isNextPageError={feed.isFetchNextPageError}
          isRefetching={feed.isRefetching}
          pageCount={pages?.length ?? 0}
          fetchNextPage={feed.fetchNextPage}
        />
      </>
    )
  }

  // Совсем пустая лента без фильтров — фильтровать и подводить итоги нечего.
  const firstRun = !isPending && failed.length === 0 && items.length === 0 && !filtered
  return (
    <>
      <PageHeader title={t.nav.transactions} />
      <div className={classes.stack}>
        {!firstRun && (
          <FeedFilterBar
            filters={filters}
            onChange={setFilters}
            accounts={accounts}
            categories={categoryList}
            today={today}
            chipCount={chips.filter((c) => c.key !== 'q').length}
            search={search}
            onSearch={onSearch}
          />
        )}
        <ActiveFilterChips chips={chips} onChange={setFilters} onReset={resetFilters} />
        {/* Итоги — над лентой; «Ничего не найдено» итогами не дублируем. */}
        {failed.length === 0 && !isPending && items.length > 0 && (
          <FeedSummary query={summary} filtered={filtered} />
        )}
        <div aria-busy={feed.isPlaceholderData || undefined}>{content}</div>
        <VisuallyHidden role="status" aria-live="polite">
          {announced.message}
        </VisuallyHidden>
      </div>
      <EditTransactionSheet
        sheet={sheet}
        transaction={sheetTransaction}
        title={
          sheetTransaction
            ? transactionTitle(sheetTransaction, { accountNames, categories }, t)
            : ''
        }
        onEdited={onEdited}
        onDelete={remove}
      />
    </>
  )
}
