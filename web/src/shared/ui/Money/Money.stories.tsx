import { Stack, Table, Text } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { Money } from './Money'

const meta = {
  title: 'UI/Money',
  component: Money,
  args: {
    amount: 1234567,
    currency: 'RUB',
    variant: 'plain',
    size: 'md',
  },
  argTypes: {
    variant: { control: 'inline-radio', options: ['plain', 'flow', 'balance'] },
    currency: { control: 'inline-radio', options: ['RUB', 'USD', 'JPY'] },
    size: { control: 'inline-radio', options: ['xs', 'sm', 'md', 'lg', 'xl'] },
  },
} satisfies Meta<typeof Money>

export default meta
type Story = StoryObj<typeof meta>

/** Копейки есть — показываем: `12 345,67 ₽`. */
export const WithKopecks: Story = {}

/** Копеек нет — скрываем: `1 200 ₽`. */
export const WholeRubles: Story = { args: { amount: 120000 } }

/** Отчёты и балансы: всегда до рублей. */
export const RoundedToRubles: Story = { args: { amount: 8430050, roundToMajor: true } }

/** Расход в ленте: настоящий минус и обычный цвет текста — не красный. */
export const FlowExpense: Story = { args: { amount: -59000, variant: 'flow' } }

/** Доход в ленте: «+» и зелёный цвет. */
export const FlowIncome: Story = { args: { amount: 8500000, variant: 'flow' } }

/** Отрицательный остаток — проблема, поэтому красный. Минус остаётся: цвет не единственный признак. */
export const NegativeBalance: Story = { args: { amount: -1520000, variant: 'balance' } }

/** −40 коп. с округлением до рублей — «0 ₽» без минуса и не красным: цвет по показанному значению. */
export const RoundedToZero: Story = {
  args: { amount: -40, variant: 'balance', roundToMajor: true },
}

/** Иена: минимальных единиц нет, знаки берутся из ISO 4217 автоматически. */
export const Yen: Story = { args: { amount: 1500, currency: 'JPY' } }

/** Положительный остаток — обычным цветом. */
export const PositiveBalance: Story = { args: { amount: 25000000, variant: 'balance' } }

/** Валютный счёт. */
export const Dollars: Story = { args: { amount: 5050, currency: 'USD' } }

/** Главная цифра экрана. */
export const LargeBalance: Story = {
  args: { amount: 123456789000, size: 'xl', fw: 600, roundToMajor: true },
}

/** Табличные цифры: суммы разной длины выравниваются по разрядам в колонке. */
export const ColumnAlignment: Story = {
  render: () => (
    <Table w="auto" withRowBorders={false} verticalSpacing="xs">
      <Table.Tbody>
        {[
          ['Продукты', -128050],
          ['Зарплата', 15000000],
          ['Кафе', -111100],
          ['Такси', -88800],
          ['Кешбэк', 1234],
        ].map(([label, amount]) => (
          <Table.Tr key={label}>
            <Table.Td>{label}</Table.Td>
            <Table.Td ta="right">
              <Money amount={amount as number} currency="RUB" variant="flow" />
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  ),
}

/** Внутри приглушённого текста `plain` наследует цвет и размер родителя. */
export const InheritsParentStyle: Story = {
  render: () => (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        ≈ <Money amount={460512} currency="RUB" /> по курсу ЦБ
      </Text>
      <Text size="xs" c="dimmed">
        Итог дня: <Money amount={-361050} currency="RUB" />
      </Text>
    </Stack>
  ),
}

/**
 * `wrap`: в узком месте огромная сумма переносится по разрядам, а не посреди числа
 * и не вылезает за край. При копировании текст тот же — `<wbr>` в него не попадает.
 */
export const WrapByDigitGroups: Story = {
  args: { amount: 99999999999999, size: 'xl', fw: 600, variant: 'balance', wrap: true },
  decorators: [
    (Story) => (
      <Stack gap="xs" maw={160}>
        <Story />
        <Text size="xs" c="dimmed">
          Контейнер 160 px
        </Text>
      </Stack>
    ),
  ],
}
