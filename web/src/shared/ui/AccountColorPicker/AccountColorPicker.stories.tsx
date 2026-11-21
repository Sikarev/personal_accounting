import { Paper, Stack, Text } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import type { AccountColor } from '../../api'
import { AccountMark } from '../AccountMark/AccountMark'
import { AccountColorPicker } from './AccountColorPicker'

function ColorDemo({ initial }: { initial: AccountColor | null }) {
  const [value, setValue] = useState(initial)
  return (
    <Paper withBorder radius="lg" p="md" maw={420}>
      <Stack gap="md">
        <AccountColorPicker value={value} onChange={setValue} />
        <Stack gap="xs" align="flex-start">
          <Text size="sm" c="dimmed">
            Метка счёта с этим цветом:
          </Text>
          <AccountMark type="card" color={value} />
        </Stack>
      </Stack>
    </Paper>
  )
}

const meta = {
  title: 'UI/AccountColorPicker',
  component: ColorDemo,
  args: { initial: null },
  parameters: {
    docs: {
      description: {
        component:
          'Группа радиокнопок: Tab — в группу, стрелки — выбор цвета. Каждый образец подписан названием цвета, выбранный отмечен галочкой. Образец 44 × 44 px.',
      },
    },
  },
} satisfies Meta<typeof ColorDemo>

export default meta
type Story = StoryObj<typeof meta>

/** Цвет не выбран. */
export const NoColor: Story = {}

/** Выбран цвет. */
export const Selected: Story = { args: { initial: 'teal' } }

/** Светлый цвет: галочка и иконка метки — тёмные (autoContrast). */
export const LightColor: Story = { args: { initial: 'yellow' } }
