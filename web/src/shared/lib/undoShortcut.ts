// Горячая клавиша «Отменить» (Ctrl+Z / ⌘Z) для тостов с отменой.
// Логика отделена от DOM и Mantine, чтобы её можно было проверить юнит-тестами.

/** Минимум полей KeyboardEvent, который нам нужен (удобно подменять в тестах). */
export type UndoKeyEvent = {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  target: unknown
}

/** Ctrl+Z или ⌘Z без Shift и Alt (Ctrl+Shift+Z — это «повторить»). */
export function isUndoShortcut(event: UndoKeyEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false
  // code — физическая клавиша: в русской раскладке key будет «я», а code всё равно KeyZ.
  return event.code === 'KeyZ' || event.key.toLowerCase() === 'z'
}

// Поля ввода, где Ctrl+Z — нативная отмена набранного текста.
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

type EditableLike = { tagName?: string; type?: string; isContentEditable?: boolean }

/** Фокус в редактируемом поле: там Ctrl+Z принадлежит браузеру, перехватывать нельзя. */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as EditableLike
  if (el.isContentEditable) return true
  const tag = el.tagName?.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((el.type ?? 'text').toLowerCase())
  return false
}

type UndoEntry = { id: string; undo: () => void }

/**
 * Стек действий, которые сейчас можно отменить (их тосты на экране).
 * Горячая клавиша отменяет последнее из них.
 */
export function createUndoStack() {
  const entries: UndoEntry[] = []

  return {
    push(entry: UndoEntry) {
      entries.push(entry)
    },
    remove(id: string) {
      const index = entries.findIndex((e) => e.id === id)
      if (index !== -1) entries.splice(index, 1)
    },
    get size() {
      return entries.length
    },
    /**
     * Обрабатывает нажатие. Возвращает `true`, если отменил действие —
     * тогда вызывающий код гасит событие (`preventDefault`).
     */
    handleKeydown(event: UndoKeyEvent): boolean {
      if (!isUndoShortcut(event) || isEditableTarget(event.target)) return false
      const last = entries.pop()
      if (!last) return false
      last.undo()
      return true
    },
  }
}

/** Подпись сочетания для подсказки: на Mac — ⌘Z, иначе Ctrl+Z. */
export function undoShortcutLabel(platform: string): string {
  return /mac|iphone|ipad/i.test(platform) ? '⌘Z' : 'Ctrl+Z'
}
