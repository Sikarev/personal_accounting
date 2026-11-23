import { Text, UnstyledButton } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconCheck, IconChevronDown } from '@tabler/icons-react'
import { useId, type ReactNode } from 'react'

import type { Account } from '../../api'
import { useT } from '../../i18n'
import { groupActiveAccounts, isNegativeBalanceProblem } from '../../lib/accounts'
import { AccountMark } from '../AccountMark/AccountMark'
import { Money } from '../Money/Money'
import { ResponsiveSheet } from '../ResponsiveSheet/ResponsiveSheet'
import { icons } from '../../../theme'
import classes from './AccountPicker.module.css'

export type AccountPickerProps = {
  /** Все счета пользователя (как из `GET /accounts`); архивные в выбор не попадают. */
  accounts: readonly Account[]
  /** Id выбранного счёта; `null` — не выбран. */
  value: string | null
  onChange: (accountId: string) => void
  /** Что выбирается («Счёт», «Куда»): начало доступного имени кнопки и заголовок окна. */
  label?: string
  /** Что показать в окне, если активных счетов нет (например, кнопку «Создать счёт»). */
  emptyAction?: ReactNode
  disabled?: boolean
}

/**
 * Выбор счёта для быстрого ввода (ux.md: «Счёт и дата показаны компактно и меняются
 * по касанию»). Компактная кнопка с меткой и названием счёта; по касанию — окно
 * (`ResponsiveSheet`: на mobile — снизу, на desktop — модалка) со списком активных счетов,
 * разбитым на «Общие» и «Личные», у каждого — остаток.
 *
 * Данные не загружает: счета и выбранный id приходят снаружи — компонент легко
 * переиспользовать и показать в Storybook.
 *
 * Клавиатура: Tab по счетам, Enter/Space — выбрать (окно закрывается, фокус
 * возвращается на кнопку), Esc — закрыть без изменений. Пункты — не ниже 44 px.
 */
export function AccountPicker({
  accounts,
  value,
  onChange,
  label,
  emptyAction,
  disabled,
}: AccountPickerProps) {
  const t = useT()
  const [opened, { open, close }] = useDisclosure(false)
  const groups = groupActiveAccounts(accounts)
  // Выбранный может быть архивным (правка старой операции): на кнопке он виден,
  // но в списке выбора архивных нет.
  const selected = accounts.find((a) => a.id === value) ?? null
  const isEmpty = groups.shared.length === 0 && groups.private.length === 0
  const title = label ?? t.accounts.picker.label
  const sharedId = useId()
  const privateId = useId()

  // Видимый текст кнопки — он же в доступном имени (WCAG 2.5.3: имя содержит подпись).
  const buttonText = selected?.name ?? (isEmpty ? t.accounts.picker.empty : t.accounts.picker.title)

  const select = (id: string) => {
    onChange(id)
    close()
  }

  const renderGroup = (items: Account[], heading: string, headingId: string) =>
    items.length > 0 && (
      <section aria-labelledby={headingId} className={classes.group}>
        <Text id={headingId} component="h3" size="sm" fw={600} c="dimmed">
          {heading}
        </Text>
        <ul className={classes.list}>
          {items.map((account) => {
            const isSelected = account.id === value
            return (
              <li key={account.id}>
                <UnstyledButton
                  className={classes.option}
                  data-selected={isSelected || undefined}
                  aria-pressed={isSelected}
                  onClick={() => select(account.id)}
                  // Фокус при открытии — на выбранном счёте (Mantine ищет data-autofocus).
                  data-autofocus={isSelected || undefined}
                >
                  <AccountMark type={account.type} color={account.color} size="md" />
                  <Text component="span" className={classes.name} truncate="end">
                    {account.name}
                  </Text>
                  <Money
                    amount={account.balance}
                    currency={account.currency}
                    variant={isNegativeBalanceProblem(account) ? 'balance' : 'plain'}
                    size="sm"
                  />
                  <span className={classes.check} aria-hidden>
                    {isSelected && <IconCheck size={icons.size.md} stroke={icons.stroke} />}
                  </span>
                </UnstyledButton>
              </li>
            )
          })}
        </ul>
      </section>
    )

  return (
    <>
      <UnstyledButton
        className={classes.trigger}
        onClick={open}
        disabled={disabled}
        aria-haspopup="dialog"
        // Имя кнопки: «Счёт: Карта». Видимый текст — только название, он входит в имя.
        aria-label={`${title}: ${buttonText}`}
      >
        {selected && <AccountMark type={selected.type} color={selected.color} size="md" />}
        <Text component="span" className={classes.triggerName} truncate="end">
          {buttonText}
        </Text>
        <IconChevronDown
          aria-hidden
          size={icons.size.md}
          stroke={icons.stroke}
          className={classes.chevron}
        />
      </UnstyledButton>

      <ResponsiveSheet opened={opened} onClose={close} title={title} desktopSize="sm">
        {isEmpty ? (
          <div className={classes.empty}>
            <Text c="dimmed">{t.accounts.picker.empty}</Text>
            {emptyAction}
          </div>
        ) : (
          <div className={classes.groups}>
            {renderGroup(groups.shared, t.accounts.shared, sharedId)}
            {renderGroup(groups.private, t.accounts.private, privateId)}
          </div>
        )}
      </ResponsiveSheet>
    </>
  )
}
