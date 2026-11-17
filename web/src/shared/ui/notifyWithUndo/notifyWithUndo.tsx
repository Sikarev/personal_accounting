import { Button, Group, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import type { ReactNode } from 'react'

import { messages } from '../../i18n'
import classes from './notifyWithUndo.module.css'

/** Сколько живёт тост с отменой: достаточно, чтобы заметить ошибку и нажать «Отменить». */
export const UNDO_TIMEOUT_MS = 6000

export type NotifyWithUndoOptions = {
  /** Что произошло: «Расход 590 ₽ · Продукты». */
  message: ReactNode
  /** Откатить действие. Вызывается не больше одного раза. */
  onUndo: () => void
  /** Подпись кнопки, по умолчанию «Отменить». */
  undoLabel?: string
  /** Время жизни тоста в мс. */
  autoClose?: number
}

let counter = 0

/**
 * Тост «действие выполнено · Отменить» (ux.md, принцип 4: отмена вместо подтверждения).
 * Действие уже выполнено к моменту показа; кнопка откатывает его и закрывает тост.
 * Возвращает id уведомления — им можно закрыть тост досрочно (`notifications.hide(id)`).
 */
export function notifyWithUndo({
  message,
  onUndo,
  undoLabel = messages.common.undo,
  autoClose = UNDO_TIMEOUT_MS,
}: NotifyWithUndoOptions): string {
  counter += 1
  const id = `undo-${counter}`
  let undone = false

  const handleUndo = () => {
    if (undone) return
    undone = true
    notifications.hide(id)
    onUndo()
  }

  notifications.show({
    id,
    autoClose,
    withCloseButton: false,
    message: (
      <Group justify="space-between" wrap="nowrap" gap="md">
        <Text size="sm" c="var(--mantine-color-text)" lineClamp={2}>
          {message}
        </Text>
        <Button variant="subtle" size="sm" className={classes.undo} onClick={handleUndo}>
          {undoLabel}
        </Button>
      </Group>
    ),
  })

  return id
}
