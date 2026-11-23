import { Checkbox, NativeSelect, Radio, Stack, Text, TextInput } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

import {
  AccountType,
  useCreateAccount,
  useUpdateAccount,
  type Account,
  type AccountColor,
  type AccountVisibility,
  type Currency,
} from '../../shared/api'
import { useT, type Messages } from '../../shared/i18n'
import { minorUnitsOf } from '../../shared/lib/accounts'
import { formatMoneyInput, parseMoneyInput } from '../../shared/lib/moneyInput'
import { submitErrorState } from '../../shared/lib/submitErrorState'
import { useFormState, type FormErrors } from '../../shared/lib/useFormState'
import { AccountColorPicker, SubmitForm } from '../../shared/ui'
import { accountMutationOptions, upsertAccount } from './accountsCache'
import classes from './AccountsPage.module.css'

/** Длина названия из контракта (`AccountName`). */
const NAME_MAX_LENGTH = 100
const DEFAULT_CURRENCY = 'RUB'
const FIELDS = ['name', 'type', 'currency', 'initialBalance', 'visibility', 'color'] as const

type Values = {
  name: string
  type: AccountType
  currency: string
  initialBalance: string
  visibility: AccountVisibility
  includeInTotal: boolean
  color: AccountColor | null
}

function initialValues(account: Account | null, currencies: readonly Currency[]): Values {
  if (account) {
    return {
      name: account.name,
      type: account.type,
      currency: account.currency,
      initialBalance: formatMoneyInput(
        account.initialBalance,
        minorUnitsOf(account.currency, currencies),
      ),
      visibility: account.visibility,
      includeInTotal: account.includeInTotal,
      color: account.color,
    }
  }
  const hasRub = currencies.length === 0 || currencies.some((c) => c.code === DEFAULT_CURRENCY)
  return {
    name: '',
    type: 'card',
    currency: hasRub ? DEFAULT_CURRENCY : currencies[0].code,
    initialBalance: '',
    visibility: 'shared',
    includeInTotal: true,
    color: null,
  }
}

function validate(v: Values, minorUnits: number, t: Messages) {
  const errors: FormErrors = {}
  if (!v.name.trim()) errors.name = t.accounts.form.nameRequired
  const balance = parseMoneyInput(v.initialBalance, minorUnits, t)
  // Пустой начальный остаток — ноль: умное значение по умолчанию (ux.md, принцип 3).
  if (!balance.ok && balance.code !== 'empty') errors.initialBalance = balance.message
  return { errors, initialBalance: balance.ok ? balance.value : 0 }
}

export type AccountFormProps = {
  /** Редактируемый счёт; `null` — создание нового. */
  account: Account | null
  /** Активные валюты (`GET /currencies`). */
  currencies: readonly Currency[]
  /** Счёт сохранён — закрыть окно. */
  onDone: () => void
  /** Дополнительные действия под формой (корректировка, архив, удаление). */
  footer?: ReactNode
}

/**
 * Создание и редактирование счёта. Валюту и видимость после создания поменять нельзя
 * (API их не меняет) — при редактировании они показаны текстом.
 * Ошибка сети не стирает введённое: сообщение над формой с кнопкой «Повторить».
 */
export function AccountForm({ account, currencies, onDone, footer }: AccountFormProps) {
  const t = useT()
  const qc = useQueryClient()
  const form = useFormState<Values>(initialValues(account, currencies))
  const [formError, setFormError] = useState<{ text: string; retryable: boolean } | null>(null)
  const mutation = accountMutationOptions(qc)
  const create = useCreateAccount(mutation)
  const update = useUpdateAccount(mutation)
  const v = form.values
  const minorUnits = minorUnitsOf(v.currency, currencies)

  const onError = (error: unknown) => {
    const state = submitErrorState(error, t, FIELDS, {
      name: { required: t.accounts.form.nameRequired, too_short: t.accounts.form.nameRequired },
      initialBalance: { too_large: t.moneyInput.tooLarge, too_small: t.moneyInput.tooLarge },
    })
    form.showErrors(state.fieldErrors)
    setFormError(state.formError ? { text: state.formError, retryable: state.retryable } : null)
  }

  const onSuccess = (saved: Account) => {
    upsertAccount(qc, saved)
    onDone()
  }

  const submit = () => {
    const { errors, initialBalance } = validate(v, minorUnits, t)
    form.showErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length > 0) return

    const common = {
      name: v.name.trim(),
      type: v.type,
      initialBalance,
      includeInTotal: v.includeInTotal,
      color: v.color,
    }
    if (account) {
      update.mutate({ accountId: account.id, data: common }, { onSuccess, onError })
    } else {
      create.mutate(
        { data: { ...common, currency: v.currency, visibility: v.visibility } },
        { onSuccess, onError },
      )
    }
  }

  const typeOptions = Object.values(AccountType).map((type) => ({
    value: type,
    label: t.accounts.types[type],
  }))
  // Пока справочник валют грузится (или не загрузился), доступна выбранная — рубли.
  const currencyOptions = (
    currencies.length > 0 ? currencies : [{ code: v.currency, name: '' }]
  ).map((c) => ({ value: c.code, label: c.name ? `${c.code} — ${c.name}` : c.code }))

  return (
    <Stack gap="lg">
      <SubmitForm
        onSubmit={submit}
        errorsShown={form.errorsShown}
        error={formError?.text ?? null}
        retryable={formError?.retryable}
        submitLabel={account ? t.accounts.form.submitEdit : t.accounts.form.submitCreate}
        pending={create.isPending || update.isPending}
      >
        <TextInput
          size="md"
          label={t.accounts.form.name}
          maxLength={NAME_MAX_LENGTH}
          required
          withAsterisk={false}
          // Новый счёт — сразу печатать название; при правке клавиатуру не поднимаем.
          data-autofocus={account ? undefined : true}
          value={v.name}
          onChange={(e) => form.setValue('name', e.currentTarget.value)}
          error={form.errors.name}
        />
        <NativeSelect
          size="md"
          label={t.accounts.form.type}
          data={typeOptions}
          value={v.type}
          onChange={(e) => form.setValue('type', e.currentTarget.value as AccountType)}
          error={form.errors.type}
        />
        {!account && (
          <NativeSelect
            size="md"
            label={t.accounts.form.currency}
            data={currencyOptions}
            value={v.currency}
            onChange={(e) => form.setValue('currency', e.currentTarget.value)}
            error={form.errors.currency}
          />
        )}
        <TextInput
          size="md"
          label={t.accounts.form.initialBalance}
          description={t.accounts.form.initialBalanceHint}
          inputMode="decimal"
          autoComplete="off"
          value={v.initialBalance}
          onChange={(e) => form.setValue('initialBalance', e.currentTarget.value)}
          error={form.errors.initialBalance}
          rightSection={
            <Text size="sm" c="dimmed" aria-hidden>
              {v.currency}
            </Text>
          }
          rightSectionPointerEvents="none"
        />
        {account ? (
          <ReadOnlyFacts account={account} />
        ) : (
          <Radio.Group
            size="md"
            label={t.accounts.form.visibility}
            value={v.visibility}
            onChange={(value) => form.setValue('visibility', value as AccountVisibility)}
            error={form.errors.visibility}
          >
            <Stack gap="sm" mt="xs">
              <Radio
                value="shared"
                label={t.accounts.form.visibilityShared}
                description={t.accounts.form.visibilitySharedHint}
              />
              <Radio
                value="private"
                label={t.accounts.form.visibilityPrivate}
                description={t.accounts.form.visibilityPrivateHint}
              />
            </Stack>
          </Radio.Group>
        )}
        <Checkbox
          size="md"
          label={t.accounts.form.includeInTotal}
          checked={v.includeInTotal}
          onChange={(e) => form.setValue('includeInTotal', e.currentTarget.checked)}
        />
        <AccountColorPicker value={v.color} onChange={(color) => form.setValue('color', color)} />
      </SubmitForm>
      {footer}
    </Stack>
  )
}

/** Валюта и видимость существующего счёта: только для чтения. */
function ReadOnlyFacts({ account }: { account: Account }) {
  const t = useT()
  const visibility =
    account.visibility === 'shared'
      ? `${t.accounts.form.visibilityShared} · ${t.accounts.form.visibilitySharedHint.toLowerCase()}`
      : `${t.accounts.form.visibilityPrivate} · ${t.accounts.form.visibilityPrivateHint.toLowerCase()}`
  return (
    <Stack gap="xs">
      <dl className={classes.facts}>
        <Text component="dt" size="sm" c="dimmed">
          {t.accounts.form.currency}
        </Text>
        <Text component="dd">{account.currency}</Text>
        <Text component="dt" size="sm" c="dimmed">
          {t.accounts.form.visibility}
        </Text>
        <Text component="dd">{visibility}</Text>
      </dl>
      <Text size="xs" c="dimmed">
        {t.accounts.form.readOnlyHint}
      </Text>
    </Stack>
  )
}
