import { Paper, Stack, Text } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { SortableList } from './SortableList'

type Item = { id: string; name: string; hint: string }

function SortableDemo({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial)
  return (
    <Stack gap="sm" maw={480}>
      <Paper withBorder radius="lg" style={{ overflow: 'hidden' }}>
        <SortableList
          items={items}
          getId={(i) => i.id}
          getLabel={(i) => i.name}
          aria-label="Пример списка"
          // Оптимистично: порядок применяется сразу, как на экране «Счета».
          onReorder={(ids) => setItems(ids.map((id) => items.find((i) => i.id === id)!))}
          renderItem={(item) => (
            <Stack gap={0} p="md">
              <Text truncate="end" fw={500}>
                {item.name}
              </Text>
              <Text size="xs" c="dimmed">
                {item.hint}
              </Text>
            </Stack>
          )}
        />
      </Paper>
      <Text size="sm" c="dimmed">
        Порядок: {items.map((i) => i.name).join(', ')}
      </Text>
    </Stack>
  )
}

const items: Item[] = [
  { id: '1', name: 'Карта', hint: 'Потяните за ручку справа' },
  { id: '2', name: 'Наличные', hint: 'Или Tab на ручку, пробел, стрелки, пробел' },
  { id: '3', name: 'Вклад', hint: 'Esc во время перетаскивания — отмена' },
  { id: '4', name: 'Кредитная карта', hint: 'На телефоне — тянуть ручку пальцем' },
]

const meta = {
  title: 'UI/SortableList',
  component: SortableDemo,
  args: { initial: items },
  argTypes: { initial: { control: false } },
  parameters: {
    docs: {
      description: {
        component:
          'Плоский вертикальный список с перетаскиванием (@dnd-kit): мышь и касание — за ручку, клавиатура — пробел/Enter, стрелки, Esc. Экранный диктор получает русские подсказки и объявления позиций. При prefers-reduced-motion строки переставляются без анимации.',
      },
    },
  },
} satisfies Meta<typeof SortableDemo>

export default meta
type Story = StoryObj<typeof meta>

/** Несколько элементов. */
export const Default: Story = {}

/** Один элемент — ручки нет: двигать некуда. */
export const SingleItem: Story = { args: { initial: items.slice(0, 1) } }

/** Длинные названия обрезаются, ручка остаётся на месте. */
export const LongNames: Story = {
  args: {
    initial: [
      {
        id: 'a',
        name: 'Очень длинное название счёта, которое не помещается в одну строку на телефоне',
        hint: 'Обрезается с многоточием',
      },
      ...items.slice(1, 3),
    ],
  },
}
