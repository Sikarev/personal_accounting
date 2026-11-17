import { Button, Stack, Text, TextInput } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState } from 'react'

import { Money } from '../Money/Money'
import { notifyWithUndo } from './notifyWithUndo'

function notifyDeleted(onUndo: () => void, autoClose?: number) {
  notifyWithUndo({
    message: (
      <>
        Удалён расход <Money amount={59000} currency="RUB" /> · Продукты
      </>
    ),
    onUndo,
    autoClose,
  })
}

function UndoDemo({ autoOpen = false }: { autoOpen?: boolean }) {
  const [count, setCount] = useState(3)
  const restore = () => setCount((c) => c + 1)

  const remove = () => {
    setCount((c) => c - 1)
    notifyDeleted(restore)
  }

  // Для состояния «тост открыт» показываем его сразу, один раз за монтирование
  // (ref защищает от двойного вызова эффекта в StrictMode).
  const shown = useRef(false)
  useEffect(() => {
    if (!autoOpen || shown.current) return
    shown.current = true
    setCount((c) => c - 1)
    notifyDeleted(() => setCount((c) => c + 1), 60_000)
  }, [autoOpen])

  return (
    <Stack gap="md" align="flex-start">
      <Text>Операций в списке: {count}</Text>
      <Button onClick={remove} disabled={count === 0}>
        Удалить операцию
      </Button>
      <TextInput
        label="Комментарий"
        description="Ctrl+Z здесь отменяет набранный текст, а не удаление операции"
        w="100%"
        maw={360}
      />
    </Stack>
  )
}

const meta = {
  title: 'UI/notifyWithUndo',
  component: UndoDemo,
  parameters: {
    docs: {
      description: {
        component:
          'Действие выполняется сразу, а в тосте есть «Отменить» (ux.md, принцип 4). Подтверждений «Вы уверены?» нет. ' +
          'Ctrl+Z / ⌘Z отменяет последнее действие, пока тост на экране (но не в поле ввода). ' +
          'Пока фокус внутри тоста (Tab до кнопки), он не закрывается.',
      },
    },
  },
} satisfies Meta<typeof UndoDemo>

export default meta
type Story = StoryObj<typeof meta>

/** Нажмите «Удалить операцию», затем «Отменить» в тосте — счётчик вернётся. */
export const Interactive: Story = {}

/** Тост показан сразу при открытии истории. */
export const Opened: Story = { args: { autoOpen: true } }
