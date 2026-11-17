import { describe, expect, it, vi } from 'vitest'

import {
  createUndoStack,
  isEditableTarget,
  isUndoShortcut,
  undoShortcutLabel,
  type UndoKeyEvent,
} from './undoShortcut'

const body = { tagName: 'BODY' }

function key(overrides: Partial<UndoKeyEvent> = {}): UndoKeyEvent {
  return {
    key: 'z',
    code: 'KeyZ',
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: body,
    ...overrides,
  }
}

describe('isUndoShortcut', () => {
  it('Ctrl+Z и ⌘Z — отмена', () => {
    expect(isUndoShortcut(key())).toBe(true)
    expect(isUndoShortcut(key({ ctrlKey: false, metaKey: true }))).toBe(true)
  })

  it('в русской раскладке (key = «я») тоже срабатывает', () => {
    expect(isUndoShortcut(key({ key: 'я' }))).toBe(true)
  })

  it('Ctrl+Shift+Z, Alt+Ctrl+Z и просто Z — не отмена', () => {
    expect(isUndoShortcut(key({ shiftKey: true }))).toBe(false)
    expect(isUndoShortcut(key({ altKey: true }))).toBe(false)
    expect(isUndoShortcut(key({ ctrlKey: false }))).toBe(false)
    expect(isUndoShortcut(key({ key: 'y', code: 'KeyY' }))).toBe(false)
  })
})

describe('isEditableTarget', () => {
  it('текстовые поля, textarea и contenteditable — редактируемые', () => {
    expect(isEditableTarget({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(isEditableTarget({ tagName: 'INPUT', type: 'search' })).toBe(true)
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isEditableTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('кнопки, чекбоксы и обычные элементы — нет', () => {
    expect(isEditableTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false)
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isEditableTarget(body)).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('createUndoStack', () => {
  it('Ctrl+Z отменяет последнее действие, следующее нажатие — предыдущее', () => {
    const stack = createUndoStack()
    const first = vi.fn()
    const second = vi.fn()
    stack.push({ id: 'a', undo: first })
    stack.push({ id: 'b', undo: second })

    expect(stack.handleKeydown(key())).toBe(true)
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()

    expect(stack.handleKeydown(key())).toBe(true)
    expect(first).toHaveBeenCalledOnce()
    expect(stack.size).toBe(0)
  })

  it('не перехватывает Ctrl+Z в поле ввода — там это отмена набранного текста', () => {
    const stack = createUndoStack()
    const undo = vi.fn()
    stack.push({ id: 'a', undo })

    expect(stack.handleKeydown(key({ target: { tagName: 'INPUT', type: 'text' } }))).toBe(false)
    expect(stack.handleKeydown(key({ target: { tagName: 'DIV', isContentEditable: true } }))).toBe(
      false,
    )
    expect(undo).not.toHaveBeenCalled()
    expect(stack.size).toBe(1)
  })

  it('действие, чей тост закрылся, больше не отменяется', () => {
    const stack = createUndoStack()
    const undo = vi.fn()
    stack.push({ id: 'a', undo })
    stack.remove('a')

    expect(stack.handleKeydown(key())).toBe(false)
    expect(undo).not.toHaveBeenCalled()
  })
})

describe('undoShortcutLabel', () => {
  it('на Mac — ⌘Z, иначе Ctrl+Z', () => {
    expect(undoShortcutLabel('MacIntel')).toBe('⌘Z')
    expect(undoShortcutLabel('Win32')).toBe('Ctrl+Z')
    expect(undoShortcutLabel('Linux x86_64')).toBe('Ctrl+Z')
  })
})
