import { Button } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'

import { paths } from '../../app/navigation'
import {
  apiErrorText,
  useCreateTransaction,
  useGetTransactionDefaults,
  useListAccounts,
  useListCategories,
  useListCurrencies,
  useUpdateTransaction,
  type Transaction,
  type TransactionRequest,
} from '../../shared/api'
import { useT } from '../../shared/i18n'
import { EmptyState } from '../../shared/ui'
import { useToday } from '../auth/session'
import { TransactionFormSkeleton } from './TransactionFormSkeleton'
import { TransactionFormView } from './TransactionFormView'
import { notifyTransactionCreated } from './transactionToasts'
import { invalidateAfterTransactionChange, TRANSACTIONS_SCOPE } from './transactionsCache'

export type TransactionFormProps = {
  /** Правка этой операции (`PUT` тем же телом); без неё — создание. */
  transaction?: Transaction | null
  /**
   * Операция сохранена. Создание: форма уже очищена и показала тост с «Отменить» —
   * обычно больше ничего не нужно. Правка: тост и закрытие — на стороне вызывающего.
   */
  onSaved?: (transaction: Transaction) => void
  /**
   * «Создать счёт», когда счетов не хватает. По умолчанию — переход на экран «Счета».
   * Окно передаёт свой обработчик: переход с `replace` и закрытие окна.
   */
  onCreateAccount?: () => void
  /** Фокус в сумму при появлении формы (быстрый ввод). */
  autoFocus?: boolean
  /**
   * Создание по образцу (дублирование из ленты): вид, счета, суммы, категория
   * и комментарий — как у образца, дата — «сегодня». Сохраняется новой операцией.
   */
  template?: Transaction | null
  /**
   * Своё сохранение правки вместо `PUT` с ожиданием ответа — лента правит оптимистично:
   * обновляет строку сама и возвращает операцию «как будет». Кэш после ответа тоже
   * сбрасывает вызывающий.
   */
  saveEdit?: (transaction: Transaction, body: TransactionRequest) => Promise<Transaction>
}

/**
 * Форма операции с данными: счета, категории, валюты и умные значения по умолчанию
 * (`GET /transactions/defaults`), отправка, сброс кэша и тост «Отменить» после создания.
 * Одна на быстрый ввод, главную и правку в ленте; где она стоит, форма не знает.
 *
 * Состояния: загрузка — скелетон (если дольше 300 мс); ошибка загрузки счетов или
 * категорий — объяснение и «Повторить»; `defaults` и валюты не обязательны — без них
 * форма работает (первый счёт, знаки после запятой по ISO 4217).
 */
export function TransactionForm({
  transaction = null,
  onSaved,
  onCreateAccount,
  autoFocus,
  template = null,
  saveEdit,
}: TransactionFormProps) {
  const t = useT()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const today = useToday()

  const accounts = useListAccounts()
  const categories = useListCategories()
  const currencies = useListCurrencies()
  const defaults = useGetTransactionDefaults()
  // Общая очередь с правкой и удалением в ленте (TRANSACTIONS_SCOPE).
  const create = useCreateTransaction({ mutation: { scope: TRANSACTIONS_SCOPE } })
  const update = useUpdateTransaction({ mutation: { scope: TRANSACTIONS_SCOPE } })

  // Ждём и необязательные запросы (пока они идут): иначе счёт по умолчанию сменился бы
  // уже на глазах у пользователя. Их ошибка форму не блокирует.
  const loading =
    accounts.isPending || categories.isPending || currencies.isPending || defaults.isPending
  const failed = accounts.isError ? accounts : categories.isError ? categories : null

  if (failed) {
    return (
      <EmptyState
        icon={IconAlertCircle}
        titleOrder={3}
        title={t.transactions.loadError}
        description={apiErrorText(failed.error, t)}
        action={
          <Button
            variant="light"
            size="md"
            loading={accounts.isFetching || categories.isFetching}
            onClick={() => {
              void accounts.refetch()
              void categories.refetch()
            }}
          >
            {t.errors.retry}
          </Button>
        }
      />
    )
  }

  if (loading) return <TransactionFormSkeleton />

  const data = {
    accounts: accounts.data?.items ?? [],
    categories: categories.data?.items ?? [],
    currencies: currencies.data?.items ?? [],
  }

  const submit = (body: TransactionRequest) =>
    transaction
      ? saveEdit
        ? saveEdit(transaction, body)
        : update.mutateAsync({ transactionId: transaction.id, data: body })
      : create.mutateAsync({ data: body })

  const handleSaved = (saved: Transaction) => {
    if (!(transaction && saveEdit)) void invalidateAfterTransactionChange(qc)
    if (!transaction) notifyTransactionCreated(qc, saved, data, t)
    onSaved?.(saved)
  }

  return (
    <TransactionFormView
      // Новая операция для правки — новая форма с её значениями.
      key={transaction?.id ?? (template ? `copy-${template.id}` : 'new')}
      {...data}
      defaults={defaults.data ?? null}
      today={today}
      transaction={transaction}
      template={template}
      onSubmit={submit}
      onSaved={handleSaved}
      onCreateAccount={onCreateAccount ?? (() => void navigate(paths.accounts))}
      autoFocus={autoFocus}
    />
  )
}
