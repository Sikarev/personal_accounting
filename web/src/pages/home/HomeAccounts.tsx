import { Button, Paper, Text, Title, UnstyledButton } from '@mantine/core'
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { useId } from 'react'
import { Link } from 'react-router'

import { paths } from '../../app/navigation'
import type { Account } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { balanceSummary, groupActiveAccounts } from '../../shared/lib/accounts'
import { formatCount } from '../../shared/lib/plural'
import { AccountBalance, AccountMark, BalanceTotals } from '../../shared/ui'
import { icons } from '../../theme'
import { useCollapsedGroups, type AccountGroupKey } from './collapsedGroups'
import classes from './HomePage.module.css'

/**
 * Баланс и счета — один блок (один запрос `GET /accounts`): крупно общий баланс в рублях
 * (валютные счета — по курсу ЦБ), под ним счета, общие и личные раздельно, каждая группа сворачивается. Архивные счета
 * не показываются. Строки — только для чтения: всё про счёт — на экране «Счета»
 * (ссылка «Все счета»), чтобы на главной не было лишних остановок табуляции.
 */
export function HomeAccounts({ accounts }: { accounts: readonly Account[] }) {
  const t = useT()
  const balanceId = useId()
  const groups = groupActiveAccounts(accounts)
  const [collapsed, toggle] = useCollapsedGroups()
  const hasActive = groups.shared.length + groups.private.length > 0

  return (
    <Paper
      component="section"
      aria-labelledby={balanceId}
      withBorder
      radius="lg"
      className={classes.accountsCard}
    >
      <div className={classes.balance}>
        <Title id={balanceId} order={2} size="sm" fw={500} c="dimmed">
          {t.home.balanceTitle}
        </Title>
        <BalanceTotals summary={balanceSummary(accounts)} />
      </div>

      {hasActive ? (
        (['shared', 'private'] as const).map((key) => (
          <AccountGroup
            key={key}
            group={key}
            title={key === 'shared' ? t.accounts.shared : t.accounts.private}
            accounts={groups[key]}
            collapsed={collapsed[key]}
            onToggle={toggle}
          />
        ))
      ) : (
        <Text size="sm" c="dimmed" className={classes.noAccounts}>
          {t.home.noActiveAccounts}
        </Text>
      )}

      <div className={classes.cardFooter}>
        <Button
          component={Link}
          to={paths.accounts}
          variant="subtle"
          size="md"
          className={classes.touchButton}
          rightSection={<IconChevronRight size={icons.size.md} stroke={icons.stroke} />}
        >
          {t.home.allAccounts}
        </Button>
      </div>
    </Paper>
  )
}

function AccountGroup({
  group,
  title,
  accounts,
  collapsed,
  onToggle,
}: {
  group: AccountGroupKey
  title: string
  accounts: Account[]
  collapsed: boolean
  onToggle: (group: AccountGroupKey) => void
}) {
  const t = useT()
  const listId = useId()
  // Пустая группа не показывается (как на «Счетах»).
  if (accounts.length === 0) return null
  return (
    <div className={classes.group}>
      <Title order={3} size="md" className={classes.groupTitle}>
        <UnstyledButton
          className={classes.disclosure}
          aria-expanded={!collapsed}
          aria-controls={listId}
          onClick={() => onToggle(group)}
          data-account-group={group}
        >
          <span className={classes.disclosureText}>
            {title}
            <Text component="span" size="sm" c="dimmed" fw={400}>
              {formatCount(accounts.length, t.home.accountsCount)}
            </Text>
          </span>
          <IconChevronDown
            aria-hidden
            size={icons.size.md}
            stroke={icons.stroke}
            className={classes.chevron}
            data-expanded={!collapsed || undefined}
          />
        </UnstyledButton>
      </Title>
      {!collapsed && (
        <ul id={listId} className={classes.accountList} aria-label={t.accounts.listLabel(title)}>
          {accounts.map((account) => (
            <AccountRow key={account.id} account={account} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Строка счёта, как на «Счетах»: метка · название и тип · остаток (у валютного — с эквивалентом). */
function AccountRow({ account }: { account: Account }) {
  const t = useT()
  return (
    <li className={classes.accountRow}>
      <span className={classes.mark}>
        <AccountMark type={account.type} color={account.color} />
      </span>
      <span className={classes.rowMain}>
        <span className={classes.rowText}>
          <Text component="span" display="block" truncate="end" fw={500}>
            {account.name}
          </Text>
          <Text component="span" display="block" size="xs" c="dimmed" truncate="end">
            {t.accounts.types[account.type]}
            {!account.includeInTotal && ` · ${t.accounts.excluded}`}
          </Text>
        </span>
        <AccountBalance account={account} fw={500} wrap className={classes.amount} />
      </span>
    </li>
  )
}
