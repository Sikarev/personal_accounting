import { Box, Stack } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { AccountBalance, type AccountBalanceProps } from './AccountBalance'

const meta = {
  title: 'UI/AccountBalance',
  component: AccountBalance,
  args: {
    account: { type: 'card', currency: 'USD', balance: 50_000, baseBalance: 4_617_500 },
    fw: 500,
  },
  parameters: {
    docs: {
      description: {
        component:
          'Остаток счёта: сумма в валюте счёта, у валютного под ней мелко и приглушённо — ' +
          'эквивалент в рублях по курсу ЦБ, до рублей. У рублёвого счёта и у валюты без ' +
          'курса эквивалента нет.',
      },
    },
  },
} satisfies Meta<typeof AccountBalance>

export default meta
type Story = StoryObj<typeof meta>

/** Валютный счёт: 500 $, под ним ≈ 46 175 ₽. */
export const Foreign: Story = {}

/** Рублёвый счёт — эквивалента нет. */
export const Rubles: Story = {
  args: { account: { type: 'card', currency: 'RUB', balance: 4_523_050, baseBalance: 4_523_050 } },
}

/** У валюты нет курса ЦБ — только сумма в валюте, без прочерков. */
export const NoRate: Story = {
  args: { account: { type: 'card', currency: 'EUR', balance: 120_000, baseBalance: null } },
}

/** Валютная кредитка в минусе: эквивалент со знаком, не красный (минус кредитки — норма). */
export const NegativeCreditCard: Story = {
  args: {
    account: { type: 'credit_card', currency: 'USD', balance: -150_050, baseBalance: -13_857_118 },
  },
}

/** Отрицательный остаток не кредитки: сумма красная, эквивалент — приглушённый. */
export const NegativeProblem: Story = {
  args: { account: { type: 'cash', currency: 'USD', balance: -1_000, baseBalance: -92_350 } },
}

/** Огромная сумма в узкой колонке — перенос по разрядам. */
export const Huge: Story = {
  args: {
    wrap: true,
    account: {
      type: 'deposit',
      currency: 'USD',
      balance: 9_999_999_999_999,
      baseBalance: 923_499_999_999_908,
    },
  },
  decorators: [
    (Story) => (
      <Box maw={160}>
        <Story />
      </Box>
    ),
  ],
}

const listAccounts: AccountBalanceProps['account'][] = [
  { type: 'card', currency: 'RUB', balance: 4_523_050, baseBalance: 4_523_050 },
  { type: 'card', currency: 'USD', balance: 50_000, baseBalance: 4_617_500 },
  { type: 'deposit', currency: 'EUR', balance: 120_000, baseBalance: null },
]

/** В колонке справа, как в строке списка счетов: рубли, доллары, евро без курса. */
export const InList: Story = {
  render: (args) => (
    <Stack maw={360} gap="sm">
      {listAccounts.map((account) => (
        <AccountBalance key={account.currency} {...args} account={account} />
      ))}
    </Stack>
  ),
}
