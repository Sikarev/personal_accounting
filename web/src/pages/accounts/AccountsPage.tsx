import {
  Button,
  Group,
  Paper,
  Skeleton,
  Text,
  Title,
  UnstyledButton,
  VisuallyHidden,
} from '@mantine/core'
import {
  IconAlertCircle,
  IconArchive,
  IconArrowBackUp,
  IconArrowDown,
  IconArrowUp,
  IconChevronDown,
  IconPlus,
  IconScale,
  IconTrash,
  IconWallet,
} from '@tabler/icons-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import {
  apiErrorText,
  useListAccounts,
  useListCurrencies,
  type Account,
  type Currency,
} from '../../shared/api'
import { useT } from '../../shared/i18n'
import {
  archivedAccounts,
  groupActiveAccounts,
  isNegativeBalanceProblem,
  totalsByCurrency,
} from '../../shared/lib/accounts'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import {
  AccountMark,
  EmptyState,
  Money,
  PageHeader,
  ResponsiveSheet,
  SortableList,
} from '../../shared/ui'
import { icons } from '../../theme'
import { AccountForm } from '../../features/accounts/AccountForm'
import { AdjustBalanceForm } from './AdjustBalanceForm'
import { useAccountActions } from './useAccountActions'
import classes from './AccountsPage.module.css'

type Sheet = { kind: 'create' } | { kind: 'edit'; id: string } | { kind: 'adjust'; id: string }

/** Атрибуты, по которым экран находит, куда поставить фокус после архива и удаления. */
const FOCUS = {
  row: (id: string) => `[data-account-row="${id}"]`,
  archiveToggle: '[data-archive-toggle]',
  create: '[data-create-account]',
}

/**
 * Поставить фокус на первый найденный элемент. Вызывать, когда изменение уже на экране
 * (`focusWhenRendered` в `AccountsPage`); два кадра — запас на закрытие окна Mantine.
 */
function focusFirst(selectors: string[]) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const selector of selectors) {
        const el = document.querySelector<HTMLElement>(selector)
        if (el) {
          el.focus()
          return
        }
      }
    }),
  )
}

/**
 * Куда перевести фокус, когда счёт исчезает со своего места (архив, удаление, возврат
 * из архива): на соседнюю строку той же группы, иначе на «Архив (N)», иначе на «Создать
 * счёт». Без этого фокус остался бы на удалённом элементе — то есть на `body`.
 */
function focusTargets(accounts: Account[], account: Account, extra: string[] = []): string[] {
  const list =
    account.archivedAt === null
      ? groupActiveAccounts(accounts)[account.visibility]
      : archivedAccounts(accounts)
  const index = list.findIndex((a) => a.id === account.id)
  const neighbor = list[index + 1] ?? list[index - 1]
  return [
    ...(neighbor ? [FOCUS.row(neighbor.id)] : []),
    FOCUS.archiveToggle,
    ...extra,
    FOCUS.create,
  ]
}

/**
 * Экран «Счета» (requirements 5.4, 6): остатки, итог по валютам, общие и личные
 * раздельно, порядок перетаскиванием, архив. Касание строки — окно счёта, где
 * правка, корректировка остатка, архив и удаление.
 */
export function AccountsPage() {
  const t = useT()
  const query = useListAccounts()
  const currenciesQuery = useListCurrencies()
  const currencies = currenciesQuery.data?.items ?? []
  const actions = useAccountActions()
  const showSkeleton = useDelayedLoading(query.isPending)

  // Что показано в окне. Содержимое остаётся, пока окно доигрывает анимацию закрытия.
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [opened, setOpened] = useState(false)
  // Действие в окне убрало строку, открывшую окно: фокус ставим сами после закрытия.
  const [returnFocus, setReturnFocus] = useState(true)
  const afterClose = useRef<(() => void) | null>(null)
  const openSheet = (next: Sheet) => {
    setSheet(next)
    setReturnFocus(true)
    setOpened(true)
  }
  const closeSheet = () => setOpened(false)

  const accounts = query.data?.items ?? []
  const groups = groupActiveAccounts(accounts)
  const hasActive = groups.shared.length + groups.private.length > 0

  // Фокус после действия, которое убирает строку с места, ставим только тогда, когда
  // список на экране уже перерисован с этим изменением. Ждать «пару кадров» нельзя:
  // кэш TanStack Query оповещает компоненты через `setTimeout`, и под нагрузкой кадры
  // успевали раньше перерисовки — фокус вставал на ещё не исчезнувший «Архив (N)»
  // и вместе с ним уходил на `body`. Если запрос не удался и счёт откатился, ожидание
  // так и не сработает — его сбросит следующее такое действие.
  const renderedAccounts = useRef(accounts)
  const pendingFocus = useRef<{ account: Account; targets: string[] } | null>(null)
  const focusIfRendered = () => {
    const pending = pendingFocus.current
    if (!pending) return
    const now = renderedAccounts.current.find((a) => a.id === pending.account.id)
    // Счёт на экране ещё в прежнем состоянии — ждём следующей перерисовки списка.
    if (now && now.archivedAt === pending.account.archivedAt) return
    pendingFocus.current = null
    focusFirst(pending.targets)
  }
  const focusWhenRendered = (account: Account, targets: string[]) => {
    pendingFocus.current = { account, targets }
    focusIfRendered()
  }
  useEffect(() => {
    renderedAccounts.current = accounts
    focusIfRendered()
  })

  /** Действие из окна счёта, после которого строки на прежнем месте не будет. */
  const actFromSheet = (account: Account, run: (account: Account) => unknown) => {
    const targets = focusTargets(accounts, account, [FOCUS.row(account.id)])
    setReturnFocus(false)
    pendingFocus.current = null
    // Окно закрылось — фокус ставим, как только строка ушла с места (обычно уже ушла).
    afterClose.current = () => focusWhenRendered(account, targets)
    closeSheet()
    run(account)
  }

  const unarchiveFromList = (account: Account) => {
    const targets = focusTargets(accounts, account, [FOCUS.row(account.id)])
    void actions.unarchive(account)
    focusWhenRendered(account, targets)
  }

  const createButton = (
    <Button
      size="md"
      className={classes.touchButton}
      leftSection={<IconPlus size={icons.size.md} stroke={icons.stroke} />}
      onClick={() => openSheet({ kind: 'create' })}
      data-create-account
    >
      {t.accounts.create}
    </Button>
  )

  let content
  if (query.isPending) {
    content = showSkeleton ? <AccountsSkeleton /> : null
  } else if (query.isError && !query.data) {
    content = (
      <Paper withBorder radius="lg">
        <EmptyState
          icon={IconAlertCircle}
          title={t.accounts.loadError}
          description={apiErrorText(query.error, t)}
          action={
            <Button
              variant="default"
              size="md"
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {t.errors.retry}
            </Button>
          }
        />
      </Paper>
    )
  } else {
    content = (
      <AccountsContent
        accounts={accounts}
        onOpen={(account) => openSheet({ kind: 'edit', id: account.id })}
        onReorder={actions.reorder}
        onUnarchive={unarchiveFromList}
        emptyAction={createButton}
      />
    )
  }

  return (
    <>
      <PageHeader title={t.nav.accounts} actions={hasActive && createButton} />
      {content}
      <ResponsiveSheet
        opened={opened}
        onClose={closeSheet}
        title={sheetTitle(sheet, t)}
        fullHeight={sheet?.kind !== 'adjust'}
        returnFocus={returnFocus}
        onExitTransitionEnd={() => {
          afterClose.current?.()
          afterClose.current = null
        }}
      >
        {sheet && (
          <SheetContent
            // Новое окно — новая форма: введённое в другом окне не переносится.
            key={`${sheet.kind}-${'id' in sheet ? sheet.id : ''}`}
            sheet={sheet}
            accounts={accounts}
            currencies={currencies}
            onClose={closeSheet}
            onAdjust={(account) => setSheet({ kind: 'adjust', id: account.id })}
            actions={actions}
            onAct={actFromSheet}
          />
        )}
      </ResponsiveSheet>
    </>
  )
}

function sheetTitle(sheet: Sheet | null, t: ReturnType<typeof useT>) {
  if (!sheet) return ''
  if (sheet.kind === 'create') return t.accounts.form.createTitle
  if (sheet.kind === 'adjust') return t.accounts.adjust.title
  return t.accounts.form.editTitle
}

function SheetContent({
  sheet,
  accounts,
  currencies,
  onClose,
  onAdjust,
  actions,
  onAct,
}: {
  sheet: Sheet
  accounts: Account[]
  currencies: Currency[]
  onClose: () => void
  onAdjust: (account: Account) => void
  actions: ReturnType<typeof useAccountActions>
  onAct: (account: Account, run: (account: Account) => unknown) => void
}) {
  const t = useT()
  if (sheet.kind === 'create') {
    return <AccountForm account={null} currencies={currencies} onDone={onClose} />
  }
  // Счёт берём из кэша: в окне всегда свежий остаток. Пропал (удалён) — показывать нечего.
  const account = accounts.find((a) => a.id === sheet.id)
  if (!account) return null

  if (sheet.kind === 'adjust') {
    return <AdjustBalanceForm account={account} currencies={currencies} onDone={onClose} />
  }

  const archived = account.archivedAt !== null
  const act = (run: (account: Account) => unknown) => () => onAct(account, run)

  // «Выше» / «Ниже» — порядок без перетаскивания (WCAG 2.5.7): для указателя без
  // перетаскивания и для экранного диктора на телефоне. Тот же оптимистичный
  // PUT /accounts/order. Окно остаётся открытым, фокус — на нажатой кнопке; у крайних
  // позиций кнопка не отключается (`disabled` сбросил бы фокус), а помечается aria-disabled.
  const group = groupActiveAccounts(accounts)[account.visibility]
  const index = group.findIndex((a) => a.id === account.id)
  const move = (delta: -1 | 1) => () => {
    const target = index + delta
    if (index < 0 || target < 0 || target >= group.length) return
    const ids = group.map((a) => a.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    void actions.reorder(ids)
  }
  const atTop = index <= 0
  const atBottom = index < 0 || index >= group.length - 1
  return (
    <AccountForm
      account={account}
      currencies={currencies}
      onDone={onClose}
      footer={
        <div className={classes.sheetActions}>
          {!archived && group.length > 1 && (
            <div role="group" aria-label={t.accounts.actions.orderLabel} className={classes.order}>
              <Button
                variant="default"
                size="md"
                className={classes.touchButton}
                leftSection={<IconArrowUp size={icons.size.md} stroke={icons.stroke} />}
                aria-disabled={atTop || undefined}
                data-disabled={atTop || undefined}
                onClick={move(-1)}
              >
                {t.accounts.actions.moveUp}
              </Button>
              <Button
                variant="default"
                size="md"
                className={classes.touchButton}
                leftSection={<IconArrowDown size={icons.size.md} stroke={icons.stroke} />}
                aria-disabled={atBottom || undefined}
                data-disabled={atBottom || undefined}
                onClick={move(1)}
              >
                {t.accounts.actions.moveDown}
              </Button>
            </div>
          )}
          {!archived && (
            <Button
              variant="default"
              size="md"
              className={classes.touchButton}
              leftSection={<IconScale size={icons.size.md} stroke={icons.stroke} />}
              onClick={() => onAdjust(account)}
            >
              {t.accounts.actions.adjust}
            </Button>
          )}
          <Button
            variant="default"
            size="md"
            className={classes.touchButton}
            leftSection={
              archived ? (
                <IconArrowBackUp size={icons.size.md} stroke={icons.stroke} />
              ) : (
                <IconArchive size={icons.size.md} stroke={icons.stroke} />
              )
            }
            onClick={act(archived ? actions.unarchive : actions.archive)}
          >
            {archived ? t.accounts.actions.unarchiveLong : t.accounts.actions.archive}
          </Button>
          {/* Удалить можно только счёт без операций; иначе — только архив. */}
          {!account.hasTransactions && (
            <Button
              variant="default"
              size="md"
              className={classes.touchButton}
              leftSection={<IconTrash size={icons.size.md} stroke={icons.stroke} />}
              onClick={act(actions.remove)}
            >
              {t.accounts.actions.delete}
            </Button>
          )}
        </div>
      }
    />
  )
}

function AccountsContent({
  accounts,
  onOpen,
  onReorder,
  onUnarchive,
  emptyAction,
}: {
  accounts: Account[]
  onOpen: (account: Account) => void
  onReorder: (ids: string[]) => void
  onUnarchive: (account: Account) => void
  emptyAction: ReactNode
}) {
  const t = useT()
  const groups = groupActiveAccounts(accounts)
  const archived = archivedAccounts(accounts)
  const totals = totalsByCurrency(accounts)
  const hasActive = groups.shared.length + groups.private.length > 0
  const totalId = useId()

  return (
    <div className={classes.stack}>
      {hasActive ? (
        <Paper withBorder radius="lg" p="md" component="section" aria-labelledby={totalId}>
          <Text id={totalId} size="sm" c="dimmed">
            {t.accounts.total}
          </Text>
          {/* Каждая валюта — отдельный пункт: при нехватке места переносится целиком,
              а слишком длинная сумма — по разрядам (Money wrap). */}
          <Text component="ul" size="xl" fw={600} className={classes.totals}>
            {(totals.length === 0 ? [{ currency: 'RUB', amount: 0 }] : totals).map((total) => (
              <li key={total.currency}>
                <Money
                  amount={total.amount}
                  currency={total.currency}
                  variant="balance"
                  wrap
                  className={classes.wrapAmount}
                />
              </li>
            ))}
          </Text>
        </Paper>
      ) : (
        <Paper withBorder radius="lg">
          <EmptyState
            icon={IconWallet}
            title={t.pages.accounts.emptyTitle}
            description={t.pages.accounts.emptyDescription}
            action={emptyAction}
          />
        </Paper>
      )}

      <AccountGroup
        title={t.accounts.shared}
        accounts={groups.shared}
        onOpen={onOpen}
        onReorder={onReorder}
      />
      <AccountGroup
        title={t.accounts.private}
        hint={t.accounts.privateHint}
        accounts={groups.private}
        onOpen={onOpen}
        onReorder={onReorder}
      />
      <ArchiveBlock accounts={archived} onOpen={onOpen} onUnarchive={onUnarchive} />
    </div>
  )
}

function AccountGroup({
  title,
  hint,
  accounts,
  onOpen,
  onReorder,
}: {
  title: string
  hint?: string
  accounts: Account[]
  onOpen: (account: Account) => void
  onReorder: (ids: string[]) => void
}) {
  const t = useT()
  const headingId = useId()
  // Пустая группа не показывается.
  if (accounts.length === 0) return null
  return (
    <section aria-labelledby={headingId} className={classes.group}>
      <div>
        <Title id={headingId} order={2} size="lg">
          {title}
        </Title>
        {hint && (
          <Text size="sm" c="dimmed">
            {hint}
          </Text>
        )}
      </div>
      <Paper withBorder radius="lg" className={classes.listCard}>
        <SortableList
          items={accounts}
          getId={(a) => a.id}
          getLabel={(a) => a.name}
          aria-label={t.accounts.listLabel(title)}
          onReorder={onReorder}
          renderItem={(account) => <AccountRow account={account} onOpen={onOpen} />}
        />
      </Paper>
    </section>
  )
}

function AccountRow({
  account,
  onOpen,
  archived,
}: {
  account: Account
  onOpen: (account: Account) => void
  /** Архивный счёт: остаток мелко под названием — справа место для «Вернуть». */
  archived?: boolean
}) {
  const t = useT()
  const meta = (
    <>
      {t.accounts.types[account.type]}
      {!account.includeInTotal && ` · ${t.accounts.excluded}`}
    </>
  )
  return (
    <UnstyledButton
      className={classes.row}
      onClick={() => onOpen(account)}
      data-account-row={account.id}
    >
      <span className={classes.mark}>
        <AccountMark type={account.type} color={account.color} />
      </span>
      <span className={classes.rowMain}>
        <span className={classes.rowText}>
          <Text component="span" display="block" truncate="end" fw={500}>
            {account.name}
          </Text>
          <Text component="span" display="block" size="xs" c="dimmed" truncate="end">
            {archived ? (
              <>
                <Money amount={account.balance} currency={account.currency} /> · {meta}
              </>
            ) : (
              meta
            )}
          </Text>
        </span>
        {!archived && (
          <Money
            amount={account.balance}
            currency={account.currency}
            variant={isNegativeBalanceProblem(account) ? 'balance' : 'plain'}
            fw={500}
            wrap
            className={classes.amount}
          />
        )}
      </span>
    </UnstyledButton>
  )
}

function ArchiveBlock({
  accounts,
  onOpen,
  onUnarchive,
}: {
  accounts: Account[]
  onOpen: (account: Account) => void
  onUnarchive: (account: Account) => void
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  if (accounts.length === 0) return null
  return (
    <section className={classes.group}>
      <Title order={2} size="lg">
        <UnstyledButton
          className={classes.disclosure}
          aria-expanded={expanded}
          aria-controls={listId}
          data-archive-toggle
          onClick={() => setExpanded((v) => !v)}
        >
          {t.accounts.archive(accounts.length)}
          <IconChevronDown
            aria-hidden
            size={icons.size.md}
            stroke={icons.stroke}
            className={classes.chevron}
            data-expanded={expanded || undefined}
          />
        </UnstyledButton>
      </Title>
      {expanded && (
        <Paper withBorder radius="lg" className={classes.listCard} id={listId}>
          <ul className={classes.plainList}>
            {accounts.map((account) => (
              <li key={account.id} className={classes.archivedItem}>
                <div className={classes.rowGrow}>
                  <AccountRow account={account} onOpen={onOpen} archived />
                </div>
                <Button
                  variant="subtle"
                  size="md"
                  className={classes.touchButton}
                  onClick={() => onUnarchive(account)}
                  aria-label={`${t.accounts.actions.unarchive} «${account.name}»`}
                >
                  {t.accounts.actions.unarchive}
                </Button>
              </li>
            ))}
          </ul>
        </Paper>
      )}
    </section>
  )
}

const SKELETON_NAME_WIDTHS = ['48%', '62%', '36%']
const SKELETON_AMOUNT_WIDTHS = ['5rem', '4rem', '4.5rem']

/** Скелетон в форме экрана: итог и одна группа из трёх счетов. */
function AccountsSkeleton() {
  const t = useT()
  return (
    <div role="status" aria-live="polite" className={classes.stack}>
      <VisuallyHidden>{t.common.loading}</VisuallyHidden>
      <Paper withBorder radius="lg" p="md" aria-hidden>
        <Skeleton className={classes.skeletonLabel} radius="sm" />
        <Skeleton className={classes.skeletonTotal} radius="sm" mt="sm" />
      </Paper>
      <div className={classes.group} aria-hidden>
        <Skeleton className={classes.skeletonHeading} radius="sm" />
        <Paper withBorder radius="lg" className={classes.listCard}>
          {SKELETON_NAME_WIDTHS.map((width, i) => (
            <Group key={width} className={classes.skeletonRow} wrap="nowrap" gap="md">
              <Skeleton circle className={classes.skeletonMark} />
              <div className={classes.rowText}>
                <Skeleton className={classes.skeletonName} w={width} radius="sm" />
                <Skeleton className={classes.skeletonType} w="20%" radius="sm" mt="xs" />
              </div>
              <Skeleton
                className={classes.skeletonName}
                w={SKELETON_AMOUNT_WIDTHS[i]}
                radius="sm"
              />
            </Group>
          ))}
        </Paper>
      </div>
    </div>
  )
}
