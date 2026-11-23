import { Paper } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { ApiError, NetworkError, type Category, type Transaction } from '../../shared/api'
import { storyAccount } from '../../shared/ui/AccountPicker/storyFixtures'
import { TransactionFormView, type TransactionFormViewProps } from './TransactionFormView'

// Форма операции без загрузки данных: счета, категории и умные значения — пропсами,
// отправка — функция, которая отвечает успехом или ошибкой.

const card = storyAccount({ name: 'Карта Сбер', color: 'green', balance: 1_234_567 })
const cash = storyAccount({ name: 'Наличные', type: 'cash', balance: 500_000 })
const usd = storyAccount({
  name: 'Доллары',
  currency: 'USD',
  visibility: 'private',
  balance: 50_000,
})
const accounts = [card, cash, usd]

let seq = 0
function cat(name: string, kind: 'expense' | 'income' = 'expense', parentId: string | null = null) {
  seq += 1
  const c: Category = { id: `c${seq}`, kind, parentId, name, sortOrder: seq, archivedAt: null }
  return c
}
const food = cat('Продукты')
const cafe = cat('Кафе и рестораны')
const transport = cat('Транспорт')
const taxi = cat('Такси', 'expense', transport.id)
const health = cat('Здоровье')
const salary = cat('Зарплата', 'income')
const gifts = cat('Подарки', 'income')
const categories = [food, cafe, transport, taxi, health, salary, gifts]

const currencies = [
  { code: 'RUB', name: 'Российский рубль', symbol: '₽', minorUnits: 2 },
  { code: 'USD', name: 'Доллар США', symbol: '$', minorUnits: 2 },
]

const defaults = {
  expenseAccountId: card.id,
  incomeAccountId: card.id,
  transfer: { accountId: card.id, toAccountId: usd.id },
  frequentCategories: {
    expense: [food.id, taxi.id, cafe.id, health.id],
    income: [salary.id, gifts.id],
  },
}

const saved = (): Promise<Transaction> =>
  new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          id: 'tx',
          kind: 'expense',
          date: '2026-11-23',
          accountId: card.id,
          amount: 59000,
          currency: 'RUB',
          toAccountId: null,
          toAmount: null,
          toCurrency: null,
          categoryId: food.id,
          comment: '',
          author: null,
          counterparty: null,
          editable: true,
          createdAt: '',
          updatedAt: '',
        }),
      400,
    ),
  )

function FormDemo(props: TransactionFormViewProps) {
  return (
    <Paper withBorder radius="lg" p="lg" maw={480}>
      <TransactionFormView {...props} />
    </Paper>
  )
}

const meta = {
  title: 'Features/TransactionForm',
  component: FormDemo,
  args: {
    accounts,
    categories,
    currencies,
    defaults,
    today: '2026-11-23',
    onSubmit: saved,
    onCreateAccount: () => {},
  },
  argTypes: {
    accounts: { control: false },
    categories: { control: false },
    currencies: { control: false },
    defaults: { control: false },
    transaction: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component:
          'Общая форма операции: быстрый ввод, главная (desktop) и правка в ленте. ' +
          'Повторяющийся расход — сумма → чип категории → Enter. После сохранения вид, счёт и ' +
          'дата остаются, сумма, категория и комментарий очищаются, фокус — в сумме. ' +
          'Индикатор на кнопке — только если ответ дольше 300 мс.',
      },
    },
  },
} satisfies Meta<typeof FormDemo>

export default meta
type Story = StoryObj<typeof meta>

/** Расход: значения по умолчанию — последний счёт и частые категории. */
export const Expense: Story = {}

/** Доход. */
export const Income: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByText('Доход'))
  },
}

/** Расход с выражением и выбранной категорией. */
export const ExpenseWithExpression: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Сумма'), '350+120*2')
    await userEvent.click(canvas.getByText('Продукты'))
    await expect(canvas.getByText(/^=/)).toBeVisible()
  },
}

/** Перевод в одной валюте. */
export const Transfer: Story = {
  args: { defaults: { ...defaults, transfer: { accountId: card.id, toAccountId: cash.id } } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByText('Перевод'))
  },
}

/** Перевод с обменом валют: вторая сумма и курс. */
export const TransferExchange: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByText('Перевод'))
    await userEvent.type(canvas.getByLabelText('Списано'), '9235')
    await userEvent.type(canvas.getByLabelText('Зачислено'), '100')
    await expect(canvas.getByText(/^Курс:/)).toBeVisible()
  },
}

/** Ошибки у полей после «Сохранить» с пустой формой. */
export const FieldErrors: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Сохранить расход' }))
    await expect(canvas.getByText('Введите сумму')).toBeVisible()
  },
}

/** Нет связи: сообщение над формой с «Повторить», введённое на месте. */
export const NetworkFailure: Story = {
  args: { onSubmit: () => Promise.reject(new NetworkError()) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Сумма'), '590')
    await userEvent.click(canvas.getByText('Продукты'))
    await userEvent.keyboard('{Enter}')
    await expect(await canvas.findByRole('button', { name: 'Повторить' })).toBeVisible()
  },
}

/** Ошибка сервера по полю: счёт архивировали на другом устройстве. */
export const ServerFieldError: Story = {
  args: {
    onSubmit: () =>
      Promise.reject(
        new ApiError({
          status: 422,
          code: 'validation_failed',
          problem: {
            status: 422,
            code: 'validation_failed',
            errors: [{ field: 'accountId', code: 'invalid_account', message: '' }],
          },
        }),
      ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Сумма'), '590')
    await userEvent.click(canvas.getByText('Продукты'))
    await userEvent.keyboard('{Enter}')
    await expect(await canvas.findByRole('alert')).toBeVisible()
  },
}

/** Длинные названия счетов и категорий, огромная сумма. */
export const LongNamesHugeAmount: Story = {
  args: {
    accounts: [
      storyAccount({
        name: 'Накопительный счёт на отпуск в следующем году — не трогать до лета',
        balance: 999_999_999_999_99,
      }),
      card,
    ],
    categories: [
      cat('Образование детей: кружки, секции, репетиторы и летние лагеря в другом городе'),
      ...categories,
    ],
    defaults: null,
  },
  play: async ({ canvasElement }) => {
    await userEvent.type(within(canvasElement).getByLabelText('Сумма'), '99999999999,99*1')
  },
}

/** Перевод, когда счёт один: объяснение вместо формы. */
export const TransferNeedsTwoAccounts: Story = {
  args: { accounts: [card], defaults: null },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByText('Перевод'))
  },
}

/** Нет ни одного счёта. */
export const NoAccounts: Story = { args: { accounts: [], defaults: null } }

/** Правка: значения операции, кнопка по виду. */
export const Edit: Story = {
  args: {
    transaction: {
      id: 'tx',
      kind: 'transfer',
      date: '2026-11-20',
      accountId: card.id,
      amount: 923_500,
      currency: 'RUB',
      toAccountId: usd.id,
      toAmount: 10_000,
      toCurrency: 'USD',
      categoryId: null,
      comment: 'Обмен перед поездкой',
      author: null,
      counterparty: null,
      editable: true,
      createdAt: '',
      updatedAt: '',
    },
  },
}
