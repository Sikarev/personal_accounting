import { Button, Stack, Text, TextInput } from '@mantine/core'
import { IconArrowRight, IconWallet } from '@tabler/icons-react'
import { useRef, useState, type KeyboardEvent } from 'react'

import {
  fieldErrorTexts,
  apiErrorText,
  NetworkError,
  type Account,
  type Category,
  type Currency,
  type Transaction,
  type TransactionDefaults,
  type TransactionRequest,
} from '../../shared/api'
import { useT } from '../../shared/i18n'
import { minorUnitsOf } from '../../shared/lib/accounts'
import { evaluateAmount } from '../../shared/lib/amountExpression'
import { formatExchangeRate } from '../../shared/lib/money'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import { useFormState } from '../../shared/lib/useFormState'
import {
  AccountPicker,
  AmountInput,
  CategoryPicker,
  DateQuickPicker,
  EmptyState,
  SubmitForm,
} from '../../shared/ui'
import { icons } from '../../theme'
import {
  activeAccountsInOrder,
  buildRequest,
  clearedAfterCreate,
  initialValues,
  INLINE_FIELDS,
  isExchange,
  ROW_FIELDS,
  sourceAccountId,
  type TransactionFormKind,
  type TransactionFormValues,
} from './formState'
import { KindSwitch } from './KindSwitch'
import classes from './TransactionForm.module.css'

/** Предел комментария в контракте (`TransactionRequest.comment`). */
export const COMMENT_MAX_LENGTH = 500

export type TransactionFormViewProps = {
  /** Все счета (`GET /accounts`): в выборе — только активные. */
  accounts: readonly Account[]
  /** Все категории (`GET /categories`): в выборе — только активные нужного вида. */
  categories: readonly Category[]
  /** Справочник валют: знаков после запятой у суммы. */
  currencies: readonly Currency[]
  /** Умные значения (`GET /transactions/defaults`); `null` — нет или не загрузились. */
  defaults: TransactionDefaults | null
  /** «Сегодня» пользователя (`useToday()`). */
  today: string
  /** Правка этой операции; без неё — создание новой. */
  transaction?: Transaction | null
  /** Отправить на сервер (`POST` или `PUT`); ошибка — `ApiError` / `NetworkError`. */
  onSubmit: (body: TransactionRequest) => Promise<Transaction>
  /** Сервер сохранил операцию. После создания форма уже очищена, фокус — в сумме. */
  onSaved?: (transaction: Transaction) => void
  /** «Создать счёт», когда счетов не хватает. */
  onCreateAccount: () => void
  /** Фокус в сумму при появлении формы. */
  autoFocus?: boolean
}

type FormError = { text: string; retryable: boolean }

/**
 * Форма операции без загрузки данных: всё приходит пропсами (`TransactionForm` загружает
 * и передаёт; Storybook — показывает любые состояния). Не знает, где стоит — в окне быстрого
 * ввода или прямо на странице.
 *
 * Порядок — по частоте использования (ux.md, «Быстрый ввод»): вид операции, компактная
 * строка счёта и даты («Карта», «Сегодня»), сумма (фокус), частые категории чипами и поиск, комментарий.
 * Повторяющийся расход: сумма → чип → Enter.
 *
 * Enter сохраняет из любого поля: текстовые поля отправляют форму сами, а для чипов
 * и переключателя вида (радиокнопки — браузеры по Enter на них форму не отправляют
 * единообразно) — обработчик ниже. Кнопки (счёт, дата) по Enter нажимаются, как обычно.
 */
export function TransactionFormView({
  accounts,
  categories,
  currencies,
  defaults,
  today,
  transaction = null,
  onSubmit,
  onSaved,
  onCreateAccount,
  autoFocus,
}: TransactionFormViewProps) {
  const t = useT()
  const form = useFormState<TransactionFormValues>(
    initialValues({ accounts, defaults, currencies, today, transaction }),
  )
  const { values } = form
  const [formError, setFormError] = useState<FormError | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Флаг в ref, а не только в состоянии: два Enter подряд приходят раньше перерисовки.
  const submittingRef = useRef(false)
  const showLoader = useDelayedLoading(submitting)
  const containerRef = useRef<HTMLDivElement>(null)
  const amountRef = useRef<HTMLInputElement>(null)

  const active = activeAccountsInOrder(accounts)
  if (active.length === 0 && !transaction) {
    return (
      <EmptyState
        icon={IconWallet}
        titleOrder={3}
        title={t.transactions.noAccounts.title}
        description={t.transactions.noAccounts.description}
        action={
          <Button variant="light" size="md" onClick={onCreateAccount}>
            {t.transactions.noAccounts.action}
          </Button>
        }
      />
    )
  }

  const kind = values.kind
  const source = accounts.find((a) => a.id === sourceAccountId(values)) ?? null
  const sourceMinorUnits = source ? minorUnitsOf(source.currency, currencies) : 2
  const exchange = isExchange(values, accounts)
  const transferUnavailable = kind === 'transfer' && active.length < 2 && !transaction
  const rowError = ROW_FIELDS.map((f) => form.errors[f])
    .filter((text, i, all) => text && all.indexOf(text) === i)
    .join(' ')

  const clearErrors = (...fields: string[]) =>
    form.setErrors((prev) => {
      if (!fields.some((f) => Object.hasOwn(prev, f))) return prev
      const next = { ...prev }
      for (const f of fields) delete next[f]
      return next
    })

  const changeKind = (next: TransactionFormKind) => {
    form.setValues((prev) => ({ ...prev, kind: next, categoryId: null }))
    // Ошибки прежнего вида к новому не относятся.
    form.setErrors({})
    setFormError(null)
  }

  const changeAccount = (field: 'expenseAccountId' | 'incomeAccountId', id: string) => {
    form.setValue(field, id)
    clearErrors('accountId')
  }

  // Перевод: выбрали «Куда» тот же счёт, что «Откуда» (или наоборот), — меняем их местами,
  // а не показываем ошибку: так обычно и хотели.
  const changeTransfer = (side: 'from' | 'to', id: string) => {
    form.setValues((prev) => {
      const [own, other] =
        side === 'from'
          ? (['fromAccountId', 'toAccountId'] as const)
          : (['toAccountId', 'fromAccountId'] as const)
      const swap = prev[other] === id ? { [other]: prev[own] } : {}
      return { ...prev, ...swap, [own]: id }
    })
    clearErrors('accountId', 'toAccountId', 'toAmount')
  }

  const submit = async () => {
    if (submittingRef.current) return
    const built = buildRequest(values, accounts, currencies, t)
    if (!built.ok) {
      form.showErrors(built.errors)
      setFormError(null)
      return
    }
    form.showErrors({})
    setFormError(null)
    submittingRef.current = true
    setSubmitting(true)
    try {
      const saved = await onSubmit(built.body)
      if (!transaction) {
        form.setValues(clearedAfterCreate)
        amountRef.current?.focus()
      }
      onSaved?.(saved)
    } catch (error) {
      const amountOverrides = {
        too_small: t.amountInput.notPositive,
        too_large: t.moneyInput.tooLarge,
      }
      const all = fieldErrorTexts(error, t, { amount: amountOverrides, toAmount: amountOverrides })
      const known = new Set<string>([...INLINE_FIELDS, ...ROW_FIELDS])
      const hasOther = Object.keys(all).some((f) => !known.has(f))
      form.showErrors(Object.fromEntries(Object.entries(all).filter(([f]) => known.has(f))))
      setFormError(
        hasOther || Object.keys(all).length === 0
          ? { text: apiErrorText(error, t), retryable: error instanceof NetworkError }
          : null,
      )
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.defaultPrevented) return
    const target = event.target
    if (
      target instanceof HTMLInputElement &&
      (target.type === 'radio' || target.type === 'checkbox')
    ) {
      event.preventDefault()
      containerRef.current?.querySelector('form')?.requestSubmit()
    }
  }

  const amountValue = evaluateAmount(values.amount, sourceMinorUnits, t)
  const toAmountValue = exchange
    ? evaluateAmount(values.toAmount, minorUnitsOf(exchange.to.currency, currencies), t)
    : null
  const rate =
    exchange && amountValue.ok && toAmountValue?.ok
      ? formatExchangeRate(
          amountValue.value,
          exchange.from.currency,
          toAmountValue.value,
          exchange.to.currency,
          {
            fromMinorUnits: sourceMinorUnits,
            toMinorUnits: minorUnitsOf(exchange.to.currency, currencies),
          },
        )
      : null

  return (
    <div ref={containerRef} onKeyDown={handleKeyDown} className={classes.root}>
      <KindSwitch value={kind} onChange={changeKind} />

      {transferUnavailable ? (
        <EmptyState
          icon={IconArrowRight}
          titleOrder={3}
          title={t.transactions.transferNeedsTwo.title}
          description={t.transactions.transferNeedsTwo.description}
          action={
            <Button variant="light" size="md" onClick={onCreateAccount}>
              {t.transactions.transferNeedsTwo.action}
            </Button>
          }
        />
      ) : (
        <SubmitForm
          onSubmit={() => void submit()}
          errorsShown={form.errorsShown}
          error={formError?.text ?? null}
          retryable={formError?.retryable}
          submitLabel={t.transactions.submit[kind]}
          pending={submitting}
          loading={showLoader}
        >
          <Stack gap="xs">
            <div className={classes.context}>
              {kind === 'transfer' ? (
                <>
                  <AccountPicker
                    accounts={accounts}
                    value={values.fromAccountId}
                    onChange={(id) => changeTransfer('from', id)}
                    label={t.transactions.from}
                  />
                  <IconArrowRight
                    aria-hidden
                    size={icons.size.md}
                    stroke={icons.stroke}
                    className={classes.separator}
                  />
                  <AccountPicker
                    accounts={accounts}
                    value={values.toAccountId}
                    onChange={(id) => changeTransfer('to', id)}
                    label={t.transactions.to}
                  />
                </>
              ) : (
                <AccountPicker
                  accounts={accounts}
                  value={kind === 'expense' ? values.expenseAccountId : values.incomeAccountId}
                  onChange={(id) =>
                    changeAccount(kind === 'expense' ? 'expenseAccountId' : 'incomeAccountId', id)
                  }
                  label={t.transactions.account}
                />
              )}
              <DateQuickPicker
                value={values.date}
                today={today}
                onChange={(date) => {
                  form.setValue('date', date)
                  clearErrors('date')
                }}
              />
            </div>
            {rowError && (
              <Text size="sm" role="alert" className={classes.rowError}>
                {rowError}
              </Text>
            )}
          </Stack>

          <AmountInput
            label={exchange ? t.transactions.fromAmount : t.transactions.amount}
            value={values.amount}
            onChange={(text) => form.setValue('amount', text)}
            currency={source?.currency ?? ''}
            minorUnits={sourceMinorUnits}
            error={form.errors.amount}
            autoFocus={autoFocus}
            inputRef={amountRef}
            required
          />

          {exchange && (
            <Stack gap="xs">
              <AmountInput
                label={t.transactions.toAmount}
                value={values.toAmount}
                onChange={(text) => form.setValue('toAmount', text)}
                currency={exchange.to.currency}
                minorUnits={minorUnitsOf(exchange.to.currency, currencies)}
                error={form.errors.toAmount}
                required
              />
              {rate && (
                <Text size="sm" c="dimmed" className={classes.rate}>
                  {t.transactions.rate(rate)}
                </Text>
              )}
            </Stack>
          )}

          {kind !== 'transfer' && (
            <CategoryPicker
              categories={categories}
              kind={kind}
              value={values.categoryId}
              onChange={(id) => form.setValue('categoryId', id)}
              frequent={defaults?.frequentCategories[kind]}
              error={form.errors.categoryId}
            />
          )}

          <TextInput
            size="md"
            label={t.transactions.comment}
            value={values.comment}
            onChange={(event) => form.setValue('comment', event.currentTarget.value)}
            maxLength={COMMENT_MAX_LENGTH}
            autoComplete="off"
            error={form.errors.comment}
          />
        </SubmitForm>
      )}
    </div>
  )
}
