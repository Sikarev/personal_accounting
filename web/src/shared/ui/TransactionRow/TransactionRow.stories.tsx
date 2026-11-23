import { ActionIcon, Box, Paper } from '@mantine/core'
import { IconDots } from '@tabler/icons-react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import type { Category, Transaction } from '../../api'
import { icons } from '../../../theme'
import { TransactionDayHeader } from './TransactionDayHeader'
import { TransactionRow } from './TransactionRow'

// Справочники: названия счетов и категории (с подкатегорией и архивной).
const accountNames = new Map([
  ['card', 'Карта'],
  ['cash', 'Наличные'],
  ['usd', 'Доллары'],
  ['shared', 'Общий бюджет'],
  ['long', 'Накопительный счёт на отпуск в следующем году — не трогать до лета'],
])

function category(id: string, name: string, parentId: string | null = null): Category {
  return { id, kind: 'expense', parentId, name, sortOrder: 0, archivedAt: null }
}

const categories = new Map(
  [
    category('food', 'Продукты'),
    category('dairy', 'Молочное', 'food'),
    category('salary', 'Зарплата'),
    category('long', 'Подарки родственникам и друзьям на дни рождения и праздники'),
  ].map((c) => [c.id, c]),
)

let seq = 0
function tx(overrides: Partial<Transaction>): Transaction {
  seq += 1
  return {
    id: `tx-${seq}`,
    kind: 'expense',
    date: '2026-11-23',
    accountId: 'card',
    amount: 59_000,
    currency: 'RUB',
    toAccountId: null,
    toAmount: null,
    toCurrency: null,
    categoryId: 'food',
    comment: '',
    author: { id: 'u1', name: 'Анна' },
    counterparty: null,
    editable: true,
    createdAt: '2026-11-23T10:00:00Z',
    updatedAt: '2026-11-23T10:00:00Z',
    ...overrides,
  }
}

const menu = (
  <ActionIcon variant="subtle" color="gray" radius="xl" size="xl" aria-label="Действия">
    <IconDots size={icons.size.md} stroke={icons.stroke} />
  </ActionIcon>
)

const meta = {
  title: 'UI/TransactionRow',
  component: TransactionRow,
  args: { accountNames, categories, transaction: tx({}) },
  decorators: [
    (Story) => (
      <Paper withBorder radius="lg" px="md" maw={640}>
        <Story />
      </Paper>
    ),
  ],
} satisfies Meta<typeof TransactionRow>

export default meta
type Story = StoryObj<typeof meta>

/** Расход: «−590 ₽» обычным цветом. */
export const Expense: Story = {
  args: { transaction: tx({ comment: 'Хлеб и молоко' }), actions: menu },
}

/** Подкатегория — с приглушённым родителем. */
export const Subcategory: Story = {
  args: { transaction: tx({ categoryId: 'dairy', amount: 12_990 }), actions: menu },
}

/** Доход: «+» и зелёный. */
export const Income: Story = {
  args: {
    transaction: tx({ kind: 'income', categoryId: 'salary', amount: 15_000_000 }),
    actions: menu,
  },
}

/** Перевод между своими счетами: сумма без знака. */
export const Transfer: Story = {
  args: {
    transaction: tx({
      kind: 'transfer',
      categoryId: null,
      toAccountId: 'cash',
      toAmount: 500_000,
      toCurrency: 'RUB',
      amount: 500_000,
    }),
    actions: menu,
  },
}

/** Обмен валют: обе суммы, зачисление — мелко под списанием. */
export const Exchange: Story = {
  args: {
    transaction: tx({
      kind: 'transfer',
      categoryId: null,
      accountId: 'card',
      amount: 9_250_000,
      toAccountId: 'usd',
      toAmount: 100_000,
      toCurrency: 'USD',
      comment: 'Курс 92,5',
    }),
    actions: menu,
  },
}

/** Перевод с чужого личного счёта на общий: личный счёт скрыт, вместо него — владелец. */
export const HiddenSourceTransfer: Story = {
  args: {
    transaction: tx({
      kind: 'transfer',
      categoryId: null,
      accountId: null,
      amount: null,
      currency: null,
      toAccountId: 'shared',
      toAmount: 1_000_000,
      toCurrency: 'RUB',
      counterparty: { id: 'u2', name: 'Иван' },
      editable: false,
    }),
  },
}

/** Перевод с общего счёта на чужой личный. */
export const HiddenTargetTransfer: Story = {
  args: {
    transaction: tx({
      kind: 'transfer',
      categoryId: null,
      accountId: 'shared',
      amount: 300_000,
      toAccountId: null,
      counterparty: { id: 'u2', name: 'Иван' },
      editable: false,
    }),
  },
}

/** Корректировка в плюс: сумма приходит со знаком и показывается как есть. */
export const AdjustmentUp: Story = {
  args: {
    transaction: tx({ kind: 'adjustment', categoryId: null, amount: 25_050, editable: false }),
    actions: menu,
  },
}

/** Корректировка в минус. */
export const AdjustmentDown: Story = {
  args: {
    transaction: tx({ kind: 'adjustment', categoryId: null, amount: -100_000, editable: false }),
    actions: menu,
  },
}

/** Длинные названия категории, счёта и комментарий обрезаются многоточием. */
export const LongNames: Story = {
  args: {
    transaction: tx({
      categoryId: 'long',
      accountId: 'long',
      comment: 'Торт, цветы и открытка для бабушки — заказ с доставкой на субботу к обеду',
    }),
    actions: menu,
  },
}

/** Огромная сумма не ломает строку: уходит под название. */
export const HugeAmount: Story = {
  args: {
    transaction: tx({ amount: 9_999_999_999_999, comment: 'Квартира' }),
    actions: menu,
  },
}

/** Автор — только когда в семье больше одного человека. */
export const WithAuthor: Story = {
  args: {
    transaction: tx({ comment: 'Кофе', amount: 25_000 }),
    showAuthor: true,
    actions: menu,
  },
}

/** Узкая колонка (телефон с крупным шрифтом): строка перестраивается в столбик. */
export const Narrow: Story = {
  args: {
    transaction: tx({ categoryId: 'dairy', amount: 9_999_999_999_999, comment: 'Сыр' }),
    actions: menu,
  },
  decorators: [
    (Story) => (
      <Box maw="15rem">
        <Story />
      </Box>
    ),
  ],
}

/** Заголовок дня: дата и итог дня по валютам (расход «−», доход «+» зелёным). */
export const DayHeader: StoryObj<typeof TransactionDayHeader> = {
  render: () => (
    <>
      <TransactionDayHeader
        date="2026-11-23"
        today="2026-11-23"
        totals={[{ currency: 'RUB', expense: 129_000, income: 0 }]}
      />
      <TransactionDayHeader
        date="2026-11-22"
        today="2026-11-23"
        totals={[
          { currency: 'RUB', expense: 45_000, income: 15_000_000 },
          { currency: 'USD', expense: 1_250, income: 0 },
        ]}
      />
      <TransactionDayHeader date="2026-11-16" today="2026-11-23" totals={[]} />
      <TransactionDayHeader
        date="2025-11-16"
        today="2026-11-23"
        totals={[{ currency: 'RUB', expense: 0, income: 500_000 }]}
      />
    </>
  ),
}
