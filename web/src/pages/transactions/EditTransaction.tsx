import { Button, Paper, Text } from '@mantine/core'
import { IconCopy, IconTrash } from '@tabler/icons-react'
import type { KeyboardEvent } from 'react'

import { TransactionForm } from '../../features/transactions/TransactionForm'
import type { TransactionFormState } from '../../features/transactions/TransactionFormView'
import type { Transaction } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { icons } from '../../theme'
import type { RowAction } from './FeedList'
import { canDelete, canDuplicate } from './useTransactionActions'
import classes from './TransactionsPage.module.css'

type EditTransactionProps = {
  transaction: Transaction
  /** Подпись операции («Продукты › Молочное») — для имени области правки. */
  title: string
  /** Сервер сохранил правку (форма ждёт ответа и при ошибке остаётся открытой). */
  onSaved: (saved: Transaction) => void
  /** Отмена: закрыть форму. */
  onClose: () => void
  /** «Дублировать» и «Удалить» — как из меню строки. */
  onAction: (action: Exclude<RowAction, 'open'>, transaction: Transaction) => void
  /**
   * Форма на месте строки (desktop): своя рамка, «Отмена» и `Esc`. В окне (mobile)
   * закрывает само окно.
   */
  inline?: boolean
  /** Отправка и несохранённые изменения — экран не переключает строку, пока они есть. */
  onStateChange?: (state: TransactionFormState) => void
  /** Показать подсказку «Сохраните или отмените изменения» (пытались открыть другую строку). */
  hint?: boolean
}

/** Атрибут формы на месте строки: на неё экран возвращает фокус. */
export const INLINE_EDIT = 'data-inline-edit'

/**
 * Правка операции из ленты (ux.md, «Лента»): общая форма операции (`TransactionForm`)
 * и действия над ней — «Дублировать», «Удалить». Корректировку и перевод со скрытым
 * чужим счётом форма не правит и объясняет почему; удалить корректировку можно и отсюда.
 *
 * На desktop — на месте строки: `Enter` сохраняет (форма), `Esc` — отмена. `Esc` внутри
 * открытого выпадающего списка закрывает только список.
 */
export function EditTransaction({
  transaction,
  title,
  onSaved,
  onClose,
  onAction,
  inline = false,
  onStateChange,
  hint = false,
}: EditTransactionProps) {
  const t = useT()
  const icon = (I: typeof IconCopy) => <I size={icons.size.md} stroke={icons.stroke} />

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    const target = event.target as HTMLElement
    // Открытый список (Select) закрывается сам. Окно выбора счёта или даты — в портале:
    // по дереву React его Esc всплывает сюда же, но по DOM оно не внутри формы.
    if (target.getAttribute('aria-expanded') === 'true') return
    if (!event.currentTarget.contains(target)) return
    event.preventDefault()
    onClose()
  }

  const actions = (
    <div className={classes.editActions}>
      {canDuplicate(transaction) && (
        <Button
          variant="default"
          size="sm"
          className={classes.touchButton}
          leftSection={icon(IconCopy)}
          onClick={() => onAction('duplicate', transaction)}
        >
          {t.feed.actions.duplicate}
        </Button>
      )}
      {canDelete(transaction) && (
        <Button
          variant="default"
          size="sm"
          className={`${classes.touchButton} ${classes.danger}`}
          leftSection={icon(IconTrash)}
          onClick={() => onAction('delete', transaction)}
        >
          {t.feed.actions.delete}
        </Button>
      )}
      {inline && (
        <Button
          variant="subtle"
          size="sm"
          className={`${classes.touchButton} ${classes.editCancel}`}
          onClick={onClose}
        >
          {t.feed.edit.cancel}
        </Button>
      )}
      {/* role="status" — всегда в DOM: диктор объявит подсказку, когда она появится. */}
      <Text role="status" size="sm" c="dimmed" className={classes.editHint}>
        {hint ? t.feed.edit.unsavedHint : ''}
      </Text>
    </div>
  )

  const form = (
    <TransactionForm
      transaction={transaction}
      onSaved={onSaved}
      onStateChange={onStateChange}
      // На месте строки — сразу в сумму; в окне на телефоне клавиатура не нужна сразу.
      autoFocus={inline}
    />
  )

  if (!inline) {
    return (
      <div className={classes.editBody}>
        {actions}
        {form}
      </div>
    )
  }

  return (
    <Paper
      withBorder
      radius="lg"
      p="md"
      component="section"
      aria-label={t.feed.edit.inlineLabel(title)}
      className={classes.inlineEdit}
      onKeyDown={handleKeyDown}
      {...{ [INLINE_EDIT]: transaction.id }}
    >
      {actions}
      {form}
    </Paper>
  )
}
