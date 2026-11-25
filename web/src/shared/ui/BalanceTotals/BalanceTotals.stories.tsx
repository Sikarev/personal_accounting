import { Box, Text } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { BalanceTotals } from './BalanceTotals'

type DemoProps = {
  /** Общий баланс в копейках. */
  total: number
  /** Валюта → итог в её минимальных единицах. */
  converted?: Record<string, number>
  withoutRate?: Record<string, number>
  roundToMajor?: boolean
}

const totals = (sums: Record<string, number> = {}) =>
  Object.entries(sums).map(([currency, amount]) => ({ currency, amount: BigInt(amount) }))

// Аргументы историй — числа: BigInt не сериализуется в панель Controls.
function BalanceDemo({ total, converted, withoutRate, roundToMajor }: DemoProps) {
  return (
    <Box maw={420}>
      <Text size="sm" c="dimmed">
        Всего на счетах
      </Text>
      <BalanceTotals
        summary={{
          total: BigInt(total),
          converted: totals(converted),
          withoutRate: totals(withoutRate),
        }}
        roundToMajor={roundToMajor}
      />
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
          'Общий баланс одной суммой в рублях (`balanceSummary`): валютные счета — по курсу ЦБ, ' +
          'тогда перед суммой «≈», а под ней — какие валюты вошли. Валюты без курса в сумму не ' +
          'входят: «Не входит в итог: 1 200 € — нет курса ЦБ». На главной до рублей, ' +
          'на «Счетах» — с копейками (`roundToMajor={false}`). Отрицательный итог — красным.',
      },
    },
  },
} satisfies Meta<typeof BalanceDemo>

export default meta
type Story = StoryObj<typeof meta>

/** Только рубли — одна сумма, без лишних строк. */
export const Rubles: Story = { args: { total: 12_450_050 } }

/** Рубли и доллары: сумма приблизительная, под ней — какие валюты вошли. */
export const WithForeign: Story = {
  args: { total: 17_067_550, converted: { USD: 50_000 } },
}

/** Несколько валют по курсу: «1 200 € и 500 $». */
export const ManyCurrencies: Story = {
  args: { total: 29_127_550, converted: { EUR: 120_000, USD: 50_000 } },
}

/** Нет курса евро: евро в сумму не входят — приглушённая строка «Не входит в итог». */
export const NoRate: Story = {
  args: { total: 17_067_550, converted: { USD: 50_000 }, withoutRate: { EUR: 120_000 } },
}

/** Нет курса ни у одной из двух валют, рублёвых счетов нет: «Не входят в итог: …». */
export const NoRateOnly: Story = {
  args: { total: 0, withoutRate: { EUR: 120_000, USD: 50_000 } },
}

/** «Счета»: с копейками. */
export const WithKopecks: Story = {
  args: { total: 17_067_550, converted: { USD: 50_050 }, roundToMajor: false },
}

/** Нет счетов в балансе — «0 ₽». */
export const Empty: Story = { args: { total: 0 } }

/** Отрицательный итог — красным как проблема; валюты в пояснении — со знаком. */
export const Negative: Story = {
  args: { total: -2_500_000, converted: { USD: -1_000 }, withoutRate: { EUR: -5_000 } },
}

/**
 * Узкая колонка: суммы в пояснениях переносятся целиком («1 200 €» не рвётся на «1» и
 * «200 €»), главная — по разрядам.
 */
export const NarrowSentence: Story = {
  args: {
    total: 35_301_250,
    converted: { EUR: 120_000, USD: 250_000 },
    withoutRate: { CNY: 1_200_000, JPY: 250_000 },
  },
  decorators: [
    (Story) => (
      <Box maw={220}>
        <Story />
      </Box>
    ),
  ],
}

/** Огромные суммы в узкой колонке — перенос по разрядам. */
export const Huge: Story = {
  args: {
    total: 999_999_999_999_999,
    converted: { USD: 9_999_999_999_999 },
    withoutRate: { EUR: 9_999_999_999_999 },
  },
  decorators: [
    (Story) => (
      <Box maw={200}>
        <Story />
      </Box>
    ),
  ],
}
