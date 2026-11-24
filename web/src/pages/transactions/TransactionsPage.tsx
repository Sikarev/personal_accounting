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
import { EmptyState, PageHeader, TransactionListSkeleton } from '../../shared/ui'
import { icons } from '../../theme'
import { ActiveFilterChips, FeedFilterBar, type SearchState, type SetFilters } from './FeedFilters'
import { FeedList, LoadMore } from './FeedList'
import { FeedSummary } from './FeedSummary'
import { activeFilterChips } from './filterOptions'
import { rowMenuSelector, SEARCH_FIELD } from './focusTargets'
import { canDelete, useTransactionActions } from './useTransactionActions'
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

  // ——— Фокус после удаления ———
  // Строка исчезает вместе с кнопкой меню, на которой был фокус. Фокус переводим на меню
  // соседней строки (следующей, иначе предыдущей), а если удалять больше нечего — на поиск.
  // Ставим, когда строки уже нет на экране, — иначе фокус ушёл бы вместе с ней на `body`.
  const pendingFocus = useRef<{ id: string; targets: string[] } | null>(null)
  useEffect(() => {
    const pending = pendingFocus.current
    if (!pending || items.some((item) => item.id === pending.id)) return
    pendingFocus.current = null
    // Два кадра — запас на закрытие меню Mantine, которое тоже двигает фокус.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const selector of pending.targets) {
          const el = document.querySelector<HTMLElement>(selector)
          if (el) return el.focus()
        }
      }),
    )
  })

  // Обработчик удаления — постоянный: иначе мемоизированный список перерисовывался бы
  // на каждую букву поиска. Свежие строки и действия он берёт из ref.
  const latest = useRef({ items, remove: actions.remove })
  useEffect(() => {
    latest.current = { items, remove: actions.remove }
  })
  const onDelete = useCallback((transaction: Transaction) => {
    const deletable = latest.current.items.filter(canDelete)
    const index = deletable.findIndex((item) => item.id === transaction.id)
    const neighbors = [deletable[index + 1], deletable[index - 1]].filter(Boolean)
    pendingFocus.current = {
      id: transaction.id,
      targets: [...neighbors.map((n) => rowMenuSelector(n.id)), `[${SEARCH_FIELD}]`],
    }
    void latest.current.remove(transaction)
  }, [])

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
              onClick={quickAdd.open}
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
        <FeedList
          groups={groups}
          today={today}
          accountNames={accountNames}
          categories={categories}
          showAuthor={showAuthor}
          onDelete={onDelete}
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
    </>
  )
}
