import { useCallback, useMemo, useRef, useState } from 'react'

/**
 * Состояние окна правки операции: какая операция открыта, открыто ли окно и куда после
 * закрытия вернуть фокус. Содержимое остаётся, пока окно доигрывает закрытие.
 */
export function useEditSheet() {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)
  // Окно закрылось действием, которое убрало строку (удаление) — фокус ставит экран.
  const [returnFocus, setReturnFocus] = useState(true)
  // Что сделать, когда запись окна ушла из истории «Назад» (быстрый ввод для дублирования).
  const afterClose = useRef<(() => void) | null>(null)

  const open = useCallback((id: string) => {
    setEditingId(id)
    setReturnFocus(true)
    setOpened(true)
  }, [])
  const close = useCallback(() => setOpened(false), [])
  const closeForRemoval = useCallback(() => {
    setReturnFocus(false)
    setOpened(false)
  }, [])
  const closeThen = useCallback((next: () => void) => {
    afterClose.current = next
    setOpened(false)
  }, [])
  const exited = useCallback(() => setEditingId(null), [])
  const historyReleased = useCallback(() => {
    const next = afterClose.current
    afterClose.current = null
    next?.()
  }, [])

  return useMemo(
    () => ({
      editingId,
      opened,
      returnFocus,
      open,
      close,
      closeForRemoval,
      closeThen,
      exited,
      historyReleased,
    }),
    [
      editingId,
      opened,
      returnFocus,
      open,
      close,
      closeForRemoval,
      closeThen,
      exited,
      historyReleased,
    ],
  )
}

export type EditSheetState = ReturnType<typeof useEditSheet>
