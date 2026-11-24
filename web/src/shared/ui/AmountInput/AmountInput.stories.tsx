import { Box } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { AmountInput, type AmountInputProps } from './AmountInput'

type DemoProps = Omit<AmountInputProps, 'value' | 'onChange'> & { initialValue?: string }

function AmountDemo({ initialValue = '', ...props }: DemoProps) {
  const [value, setValue] = useState(initialValue)
  return (
    <Box maw={420}>
      <AmountInput value={value} onChange={setValue} {...props} />
    </Box>
  )
}

const meta = {
  title: 'UI/AmountInput',
  component: AmountDemo,
  args: { label: 'Сумма', currency: 'RUB', minorUnits: 2 },
  parameters: {
    docs: {
      description: {
        component:
          'Поле суммы с калькулятором: `+ − * /`, скобки, запятая или точка, пробелы игнорируются. ' +
          'Итог выражения — справа в строке подписи. На телефоне — кнопка «Калькулятор» открывает ряд ' +
          'знаков (на цифровой клавиатуре их нет); кнопки не забирают фокус у поля. Ошибку ' +
          'показывает форма при сохранении.',
      },
    },
  },
} satisfies Meta<typeof AmountDemo>

export default meta
type Story = StoryObj<typeof meta>

/** Пустое поле. */
export const Empty: Story = {}

/** Одно число — итога под полем нет. */
export const PlainNumber: Story = { args: { initialValue: '1 250,50' } }

/** Выражение: «= 590 ₽» справа в строке подписи. */
export const Expression: Story = { args: { initialValue: '350+120*2' } }

/** Ввод с клавиатуры: итог появляется, как только выражение разбирается. */
export const Typing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Сумма'), '(350+120)*2')
    await expect(canvas.getByText(/^=/)).toBeVisible()
  },
}

/** Мобильная раскладка: кнопка «Калькулятор» в поле, ряд знаков скрыт. */
export const CalculatorClosed: Story = {
  args: { initialValue: '1200', showOperators: true },
}

/** Ряд знаков открыт кнопкой «Калькулятор»: знак вставляется, фокус остаётся в поле. */
export const WithOperators: Story = {
  args: { initialValue: '1200', showOperators: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = canvas.getByLabelText<HTMLInputElement>('Сумма')
    await userEvent.click(input)
    await userEvent.click(canvas.getByRole('button', { name: 'Калькулятор' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Разделить' }))
    await userEvent.type(input, '3')
    await expect(input).toHaveValue('1200÷3')
    await expect(input).toHaveFocus()
  },
}

/** Ошибка при сохранении. */
export const NotPositive: Story = {
  args: { initialValue: '100-200', error: 'Сумма должна быть больше нуля' },
}

/** Неразборчивое выражение. */
export const Invalid: Story = {
  args: { initialValue: '350+*2', error: 'Не получается посчитать. Проверьте знаки и скобки' },
}

/** Огромная сумма: итог переносится, а не ломает вёрстку. */
export const Huge: Story = {
  args: { initialValue: '99999999999,99*1', showOperators: true, defaultOperatorsOpen: true },
}

/** Валюта без копеек и другая валюта. */
export const OtherCurrency: Story = {
  args: { label: 'Зачислено', currency: 'JPY', minorUnits: 0, initialValue: '15000/3' },
}
