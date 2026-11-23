import { Paper, Stack, Text } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { DateQuickPicker } from './DateQuickPicker'

const TODAY = '2026-11-23'

function DateDemo({
  initialValue = TODAY,
  disabled,
}: {
  initialValue?: string
  disabled?: boolean
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <Paper withBorder radius="lg" p="md" maw={420}>
      <Stack gap="sm">
        <DateQuickPicker value={value} onChange={setValue} today={TODAY} disabled={disabled} />
        <Text size="xs" c="dimmed">
          Выбрано: {value}
        </Text>
      </Stack>
    </Paper>
  )
}

const meta = {
  title: 'UI/DateQuickPicker',
  component: DateDemo,
  parameters: {
    docs: {
      description: {
        component:
          'Дата операции: компактная кнопка «Сегодня», по касанию — «Сегодня», «Вчера» и ' +
          '«Другой день» (нативное поле даты). «Сегодня» приходит пропсом — в приложении из ' +
          '`useToday()` (часовой пояс профиля).',
      },
    },
  },
} satisfies Meta<typeof DateDemo>

export default meta
type Story = StoryObj<typeof meta>

export const Today: Story = {}

export const Yesterday: Story = { args: { initialValue: '2026-11-22' } }

/** Другой день этого года — «Пн, 16 ноября»; прошлого года — с годом. */
export const OtherDay: Story = { args: { initialValue: '2026-11-16' } }

export const LastYear: Story = { args: { initialValue: '2025-12-31' } }

export const Disabled: Story = { args: { disabled: true } }

/** Окно выбора: «Вчера» одним касанием. */
export const PickYesterday: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Дата: Сегодня' }))
    const dialog = within(document.body).getByRole('dialog', { name: 'Дата' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Вчера' }))
    await expect(canvas.getByRole('button', { name: 'Дата: Вчера' })).toBeVisible()
  },
}

/** Окно выбора открыто. */
export const Opened: Story = {
  args: { initialValue: '2026-11-16' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Дата:/ }))
  },
}
