import { Button, Group, Paper, Stack, Text } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { useDelayedLoading } from '../../lib/useDelayedLoading'
import { TransactionListSkeleton } from './TransactionListSkeleton'

const meta = {
  title: 'UI/TransactionListSkeleton',
  component: TransactionListSkeleton,
  args: { groups: 2, rowsPerGroup: 3 },
  decorators: [
    (Story) => (
      <Paper withBorder radius="lg" p="md" maw={640}>
        <Story />
      </Paper>
    ),
  ],
} satisfies Meta<typeof TransactionListSkeleton>

export default meta
type Story = StoryObj<typeof meta>

/** Лента: две группы-дня по три операции. */
export const Default: Story = {}

/** Блок «последние операции» на главной. */
export const Compact: Story = { args: { groups: 1, rowsPerGroup: 5 } }

function DelayedLoadingDemo() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const showSkeleton = useDelayedLoading(loading)

  const load = (ms: number) => {
    setResult(null)
    setLoading(true)
    setTimeout(() => {
      setLoading(false)
      setResult(`Ответ за ${ms} мс`)
    }, ms)
  }

  return (
    <Stack gap="md">
      <Group gap="sm">
        <Button variant="default" onClick={() => load(150)} disabled={loading}>
          Быстрый ответ (150 мс)
        </Button>
        <Button variant="default" onClick={() => load(1500)} disabled={loading}>
          Медленный ответ (1,5 с)
        </Button>
      </Group>
      <Text size="sm" c="dimmed">
        Быстрый ответ не показывает скелетон вовсе, медленный — показывает после 300 мс.
      </Text>
      {showSkeleton && <TransactionListSkeleton groups={1} />}
      {result && <Text>{result}</Text>}
    </Stack>
  )
}

/** `useDelayedLoading`: индикатор не мигает, если ответ пришёл быстрее 300 мс. */
export const WithDelayedLoading: Story = {
  render: () => <DelayedLoadingDemo />,
}
