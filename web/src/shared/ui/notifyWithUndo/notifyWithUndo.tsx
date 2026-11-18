import { Button, Group, Kbd, Text } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import type { FocusEvent, ReactNode } from 'react'

import { messages } from '../../i18n'
import { matchesMobileLayout } from '../../lib/useMobileLayout'
import { createUndoStack, undoShortcutLabel } from '../../lib/undoShortcut'
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

// Действия, которые сейчас можно отменить горячей клавишей. Слушатель клавиатуры
// висит на документе, только пока на экране есть хотя бы один такой тост.
const undoStack = createUndoStack()

function handleKeydown(event: KeyboardEvent) {
  if (undoStack.handleKeydown(event)) event.preventDefault()
}

function trackUndo(id: string, undo: () => void) {
  if (undoStack.size === 0) document.addEventListener('keydown', handleKeydown)
  undoStack.push({ id, undo })
}

function untrackUndo(id: string) {
  undoStack.remove(id)
  if (undoStack.size === 0) document.removeEventListener('keydown', handleKeydown)
}

function platform(): string {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return nav.userAgentData?.platform ?? nav.platform ?? ''
}

/**
 * Тост «действие выполнено · Отменить» (ux.md, принцип 4: отмена вместо подтверждения).
 * Действие уже выполнено к моменту показа; кнопка откатывает его и закрывает тост.
 *
 * - Пока фокус внутри тоста (пользователь дошёл до кнопки с клавиатуры), он не закрывается.
 * - Ctrl+Z / ⌘Z отменяет последнее действие, пока его тост на экране. Если фокус в поле
 *   ввода, сочетание не перехватывается — там это нативная отмена набранного текста.
 * - На desktop рядом с кнопкой — подсказка о сочетании; на телефоне её нет (нет клавиатуры).
 *
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

  const shortcut = matchesMobileLayout() ? null : undoShortcutLabel(platform())

  // Пауза автозакрытия, пока фокус внутри: Mantine сама ставит паузу только по наведению
  // мыши (в обычной раскладке тостов). autoClose: false останавливает таймер, возврат
  // числа запускает его заново.
  const pause = () => notifications.update({ id, message: content, autoClose: false })
  const resume = (event: FocusEvent<HTMLElement>) => {
    // Переход фокуса между элементами внутри тоста — не уход из него.
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    notifications.update({ id, message: content, autoClose })
  }

  const content = (
    <Group justify="space-between" wrap="nowrap" gap="md">
      <Text size="sm" c="var(--mantine-color-text)" lineClamp={2}>
        {message}
      </Text>
      <Button
        variant="subtle"
        size="sm"
        className={classes.undo}
        onClick={handleUndo}
        aria-keyshortcuts="Control+Z Meta+Z"
        rightSection={
          shortcut && (
            // Подсказка видна, но не входит в имя кнопки: оно остаётся «Отменить».
            <Kbd size="xs" aria-hidden className={classes.kbd}>
              {shortcut}
            </Kbd>
          )
        }
      >
        {undoLabel}
      </Button>
    </Group>
  )

  notifications.show({
    id,
    autoClose,
    withCloseButton: false,
    onFocusCapture: pause,
    onBlurCapture: resume,
    onClose: () => untrackUndo(id),
    message: content,
  })
  trackUndo(id, handleUndo)

  return id
}
