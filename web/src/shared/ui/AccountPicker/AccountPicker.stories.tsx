import { Button, Group, Paper, Stack, Text } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import type { Account } from '../../api'
import { AccountPicker } from './AccountPicker'
import { storyAccount, storyAccounts } from './storyFixtures'

function PickerDemo({
  accounts,
  initialValue,
  withEmptyAction,
}: {
  accounts: Account[]
  initialValue: string | null
  withEmptyAction?: boolean
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <Paper withBorder radius="lg" p="md" maw={420}>
      <Stack gap="sm">
        {/* Так счёт будет выглядеть в быстром вводе: «Карта · Сегодня». */}
        <Group gap="xs" wrap="nowrap">
          <AccountPicker
            accounts={accounts}
            value={value}
            onChange={setValue}
            emptyAction={withEmptyAction && <Button variant="light">Создать счёт</Button>}
          />
          <Text c="dimmed">· Сегодня</Text>
        </Group>
        <Text size="xs" c="dimmed">
          Выбран: {value ?? 'ничего'}
        </Text>
      </Stack>
    </Paper>
  )
}

const meta = {
  title: 'UI/AccountPicker',
  component: PickerDemo,
  args: { accounts: storyAccounts, initialValue: storyAccounts[0].id },
  argTypes: { accounts: { control: false } },
  parameters: {
    docs: {
      description: {
        component:
          'Компактный выбор счёта для быстрого ввода. Касание открывает окно: на mobile — снизу, на desktop — по центру. Архивные счета в список не попадают. Данные не грузит — счета приходят пропсом.',
      },
    },
  },
} satisfies Meta<typeof PickerDemo>

export default meta
type Story = StoryObj<typeof meta>

/** Общие и личные счета, выбран первый. */
export const Default: Story = {}

/** Ничего не выбрано — подпись «Выберите счёт». */
export const NothingSelected: Story = { args: { initialValue: null } }

/** Счетов нет: кнопка «Нет счетов», в окне — действие «Создать счёт». */
export const Empty: Story = { args: { accounts: [], initialValue: null, withEmptyAction: true } }

const single = storyAccount({ name: 'Карта', balance: 1_250_050 })
/** Один счёт. */
export const SingleAccount: Story = { args: { accounts: [single], initialValue: single.id } }

const longNames = [
  storyAccount({
    name: 'Зарплатная карта Сбербанка для ежедневных покупок и коммунальных платежей',
    color: 'teal',
    balance: 4_567_800,
  }),
  storyAccount({
    name: 'Накопительный счёт на отпуск в следующем году — не трогать до лета',
    type: 'deposit',
    balance: 100_000_000,
  }),
]
/** Длинные названия обрезаются с «…» и в кнопке, и в списке. */
export const LongNames: Story = { args: { accounts: longNames, initialValue: longNames[0].id } }

const huge = [
  storyAccount({ name: 'Миллиардер', balance: 999_999_999_999_999 }),
  storyAccount({ name: 'Доллары', currency: 'USD', balance: 12_345_678_901_234 }),
]
/** Огромные суммы не ломают вёрстку. */
export const HugeAmounts: Story = { args: { accounts: huge, initialValue: huge[0].id } }

const negative = [
  storyAccount({ name: 'Карта в минусе', balance: -123_456 }),
  storyAccount({ name: 'Кредитка', type: 'credit_card', color: 'red', balance: -9_000_000 }),
]
/** Отрицательные остатки: у карты — цветом проблемы, у кредитки минус — норма. */
export const Negative: Story = { args: { accounts: negative, initialValue: negative[0].id } }

const privateOnly = storyAccounts.filter((a) => a.visibility === 'private')
/** Только личные счета — группа «Общие» не показывается. */
export const OnlyPrivate: Story = {
  args: { accounts: privateOnly, initialValue: privateOnly[0].id },
}
