import { Box, TextInput } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { ActiveFilterChips, type FilterChip } from './ActiveFilterChips'

const ALL: FilterChip<string>[] = [
  { key: 'period', label: 'Этот месяц', without: 'period' },
  { key: 'account:1', label: 'Карта', without: 'account:1' },
  {
    key: 'category:1',
    label: 'Подарки родственникам, друзьям и коллегам на праздники',
    without: 'category:1',
  },
  { key: 'q', label: '«кофе»', without: 'q' },
]

/** Обёртка с состоянием: крестик снимает чип, «Сбросить всё» — все; фокус — в поле. */
function ChipsDemo({ initial }: { initial: FilterChip<string>[] }) {
  const [chips, setChips] = useState(initial)
  return (
    <Box maw={480}>
      <TextInput label="Поиск по комментарию" data-demo-fallback mb="md" />
      <ActiveFilterChips
        chips={chips}
        onRemove={(key) => setChips((list) => list.filter((c) => c.key !== key))}
        onReset={() => setChips([])}
        fallbackFocus="[data-demo-fallback]"
      />
    </Box>
  )
}

const meta = {
  title: 'UI/ActiveFilterChips',
  component: ChipsDemo,
  args: { initial: ALL },
} satisfies Meta<typeof ChipsDemo>

export default meta
type Story = StoryObj<typeof meta>

/** Несколько фильтров, длинное название — с многоточием. */
export const Several: Story = {}

/** Один фильтр. */
export const Single: Story = { args: { initial: ALL.slice(0, 1) } }

/** Фильтров нет — компонент ничего не рисует. */
export const Empty: Story = { args: { initial: [] } }
