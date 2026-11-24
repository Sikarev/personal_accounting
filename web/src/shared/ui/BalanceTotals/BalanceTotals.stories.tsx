import { Box, Text } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { BalanceTotals } from './BalanceTotals'

function BalanceDemo(props: Parameters<typeof BalanceTotals>[0]) {
  return (
    <Box maw={420}>
      <Text id="balance-label" size="sm" c="dimmed">
        Всего на счетах
      </Text>
      <BalanceTotals {...props} labelledBy="balance-label" />
    </Box>
  )
}

const meta = {
  title: 'UI/BalanceTotals',
  component: BalanceDemo,
  parameters: {
    docs: {
      description: {
        component:
          'Общий баланс по валютам: рубли — крупно, остальные валюты — под ними мельче. ' +
          'Суммы округлены до рублей, отрицательный итог — красным (знак есть всегда), ' +
          'огромная сумма переносится по разрядам.',
      },
    },
  },
} satisfies Meta<typeof BalanceDemo>

export default meta
type Story = StoryObj<typeof meta>

/** Только рубли. */
export const Rubles: Story = { args: { totals: [{ currency: 'RUB', amount: 12_450_050 }] } }

/** Несколько валют: рубли первыми, остальные мельче. */
export const ManyCurrencies: Story = {
  args: {
    totals: [
      { currency: 'RUB', amount: 12_450_050 },
      { currency: 'EUR', amount: 85_000 },
      { currency: 'USD', amount: 120_099 },
    ],
  },
}

/** Нет рублёвых счетов — первой идёт другая валюта. */
export const NoRubles: Story = { args: { totals: [{ currency: 'USD', amount: 50_000 }] } }

/** Нет счетов в балансе — «0 ₽». */
export const Empty: Story = { args: { totals: [] } }

/** Отрицательный итог — красным как проблема. */
export const Negative: Story = {
  args: {
    totals: [
      { currency: 'RUB', amount: -2_500_000 },
      { currency: 'USD', amount: -1_000 },
    ],
  },
}

/** Огромные суммы в узкой колонке — перенос по разрядам. */
export const Huge: Story = {
  args: {
    totals: [
      { currency: 'RUB', amount: 99_999_999_999_999 },
      { currency: 'USD', amount: 9_999_999_999_999 },
    ],
  },
  decorators: [
    (Story) => (
      <Box maw={200}>
        <Story />
      </Box>
    ),
  ],
}
