import { Box, Text } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { PERIOD_PRESETS, type Period } from '../../lib/transactionFilters'
import { PeriodField, type PeriodFieldProps } from './PeriodField'

const TODAY = '2026-11-24'

/** Обёртка с состоянием: границы показываются под полем, как они ушли бы в адрес. */
function PeriodDemo({
  initial,
  ...props
}: Omit<PeriodFieldProps, 'value' | 'onChange'> & {
  initial: Period
}) {
  const [period, setPeriod] = useState(initial)
  return (
    <Box maw={360}>
      <PeriodField
        {...props}
        value={period}
        onChange={(patch) => setPeriod((p) => ({ ...p, ...patch }))}
      />
      <Text size="sm" c="dimmed" mt="sm">
        from: {period.from ?? '—'}, to: {period.to ?? '—'}
      </Text>
    </Box>
  )
}

const meta = {
  title: 'UI/PeriodField',
  component: PeriodDemo,
  args: {
    today: TODAY,
    presets: PERIOD_PRESETS,
    defaultPreset: 'all',
    initial: { from: null, to: null },
  },
} satisfies Meta<typeof PeriodDemo>

export default meta
type Story = StoryObj<typeof meta>

/** Лента: «Всё время» по умолчанию, границы необязательны. */
export const Feed: Story = {}

/** Готовый период из адреса узнаётся: 1–30 ноября — «Этот месяц». */
export const PresetDetected: Story = {
  args: { initial: { from: '2026-11-01', to: '2026-11-30' } },
}

/** Свой период: два поля даты. */
export const Custom: Story = {
  args: { initial: { from: '2026-11-03', to: '2026-11-15' } },
}

/** Отчёты: без «Всего времени», границы обязательны — пустое поле возвращает дату. */
export const Required: Story = {
  args: {
    presets: ['thisMonth', 'lastMonth', 'thisYear', 'custom'],
    defaultPreset: 'thisMonth',
    required: true,
    initial: { from: '2026-11-01', to: '2026-11-30' },
  },
}
