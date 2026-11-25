import { Group, Stack, Text, TextInput } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useAdjustAccountBalance, type Account, type Currency } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { minorUnitsOf } from '../../shared/lib/accounts'
import { parseMoneyInput } from '../../shared/lib/moneyInput'
import { submitErrorState } from '../../shared/lib/submitErrorState'
import { useFormState } from '../../shared/lib/useFormState'
import { AccountBalance, Money, notifyWithUndo, SubmitForm } from '../../shared/ui'
import { accountMutationOptions, upsertAccount } from '../../features/accounts/accountsCache'
import { undoTransaction } from '../../features/transactions/transactionToasts'

/**
 * Корректировка остатка: пользователь вводит, сколько денег на счёте на самом деле,
 * сервер записывает операцию-корректировку на разницу.
 *
 * Тост результата — с «Отменить»: удаляет операцию-корректировку, остаток возвращается.
 */
export function AdjustBalanceForm({
  account,
  currencies,
  onDone,
}: {
  account: Account
  currencies: readonly Currency[]
  onDone: () => void
}) {
  const t = useT()
  const qc = useQueryClient()
  const form = useFormState({ balance: '' })
  const [formError, setFormError] = useState<{ text: string; retryable: boolean } | null>(null)
  const adjust = useAdjustAccountBalance(accountMutationOptions(qc))
  const minorUnits = minorUnitsOf(account.currency, currencies)

  const submit = () => {
    const parsed = parseMoneyInput(form.values.balance, minorUnits, t)
    if (!parsed.ok) {
      form.showErrors({
        balance: parsed.code === 'empty' ? t.errors.field.required : parsed.message,
      })
      return
    }
    form.showErrors({})
    setFormError(null)
    // Разницу считаем от остатка, который пользователь видел, когда отправлял форму.
    const before = account.balance
    adjust.mutate(
      { accountId: account.id, data: { balance: parsed.value } },
      {
        onSuccess: ({ account: updated, transactionId }) => {
          upsertAccount(qc, updated)
          onDone()
          // Изменился ли остаток, решает сервер: операция-корректировка создана — есть её id.
          // Разница по кэшу нужна только для текста (кэш мог устареть).
          if (!transactionId) {
            notifications.show({ message: t.accounts.adjust.unchanged })
            return
          }
          // «Отменить» удаляет операцию-корректировку (техдолг №32): остаток вернётся.
          notifyWithUndo({
            message: (
              <>
                {t.accounts.adjust.done}{' '}
                <Money
                  amount={updated.balance - before}
                  currency={updated.currency}
                  variant="flow"
                />
              </>
            ),
            onUndo: () => void undoTransaction(qc, transactionId, t, t.accounts.adjust.undoFailed),
          })
        },
        onError: (error) => {
          const state = submitErrorState(error, t, ['balance'], {
            balance: { too_large: t.moneyInput.tooLarge, too_small: t.moneyInput.tooLarge },
          })
          form.showErrors(state.fieldErrors)
          setFormError(
            state.formError ? { text: state.formError, retryable: state.retryable } : null,
          )
        },
      },
    )
  }

  return (
    <SubmitForm
      onSubmit={submit}
      errorsShown={form.errorsShown}
      error={formError?.text ?? null}
      retryable={formError?.retryable}
      submitLabel={t.accounts.adjust.submit}
      pending={adjust.isPending}
    >
      <Stack gap="xs">
        <Text fw={500} truncate="end">
          {account.name}
        </Text>
        {/* Остаток валютного счёта — с эквивалентом в рублях под ним. */}
        <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
          <Text size="sm" c="dimmed">
            {t.accounts.adjust.current}
          </Text>
          <AccountBalance account={account} fw={600} />
        </Group>
      </Stack>
      <TextInput
        size="md"
        label={t.accounts.adjust.actual}
        description={t.accounts.adjust.actualHint}
        inputMode="decimal"
        autoComplete="off"
        required
        withAsterisk={false}
        // Окно открывается из окна счёта — фокус сразу в поле (единственное в форме).
        data-autofocus
        autoFocus
        value={form.values.balance}
        onChange={(e) => form.setValue('balance', e.currentTarget.value)}
        error={form.errors.balance}
        rightSection={
          <Text size="sm" c="dimmed" aria-hidden>
            {account.currency}
          </Text>
        }
        rightSectionPointerEvents="none"
      />
    </SubmitForm>
  )
}
