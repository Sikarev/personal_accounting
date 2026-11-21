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
  IconChevronDown,
  IconPlus,
  IconScale,
  IconTrash,
  IconWallet,
} from '@tabler/icons-react'
import { Fragment, useId, useState, type ReactNode } from 'react'

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
import { AccountForm } from './AccountForm'
import { AdjustBalanceForm } from './AdjustBalanceForm'
import { useAccountActions } from './useAccountActions'
import classes from './AccountsPage.module.css'

type Sheet = { kind: 'create' } | { kind: 'edit'; id: string } | { kind: 'adjust'; id: string }

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
  const openSheet = (next: Sheet) => {
    setSheet(next)
    setOpened(true)
  }
  const closeSheet = () => setOpened(false)

  const accounts = query.data?.items ?? []
  const hasAccounts = accounts.length > 0

  const createButton = (
    <Button
      size="md"
      className={classes.touchButton}
      leftSection={<IconPlus size={icons.size.md} stroke={icons.stroke} />}
      onClick={() => openSheet({ kind: 'create' })}
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
        onUnarchive={(account) => void actions.unarchive(account)}
        emptyAction={createButton}
      />
    )
  }

  return (
    <>
      <PageHeader title={t.nav.accounts} actions={hasAccounts && createButton} />
      {content}
      <ResponsiveSheet
        opened={opened}
        onClose={closeSheet}
        title={sheetTitle(sheet, t)}
        fullHeight={sheet?.kind !== 'adjust'}
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
}: {
  sheet: Sheet
  accounts: Account[]
  currencies: Currency[]
  onClose: () => void
  onAdjust: (account: Account) => void
  actions: ReturnType<typeof useAccountActions>
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
  const act = (run: (account: Account) => unknown) => () => {
    onClose()
    run(account)
  }
  return (
    <AccountForm
      account={account}
      currencies={currencies}
      onDone={onClose}
      footer={
        <div className={classes.sheetActions}>
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
          <Text component="p" size="xl" fw={600} className={classes.total}>
            {totals.length === 0 ? (
              <Money amount={0} currency="RUB" />
            ) : (
              totals.map((total, i) => (
                <Fragment key={total.currency}>
                  {i > 0 && <span aria-hidden> · </span>}
                  <Money
                    amount={total.amount}
                    currency={total.currency}
                    variant="balance"
                    className={classes.totalAmount}
                  />
                </Fragment>
              ))
            )}
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
    <UnstyledButton className={classes.row} onClick={() => onOpen(account)}>
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
