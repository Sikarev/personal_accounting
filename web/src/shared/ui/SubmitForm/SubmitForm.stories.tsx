import { Box, TextInput } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { PasswordField } from '../PasswordField/PasswordField'
import { SubmitForm } from './SubmitForm'

const meta = {
  title: 'UI/SubmitForm',
  component: SubmitForm,
  args: {
    onSubmit: () => {},
    errorsShown: 0,
    error: null,
    submitLabel: 'Войти',
    pending: false,
    children: (
      <>
        <TextInput label="E-mail" type="email" size="md" defaultValue="anna@example.com" />
        <PasswordField
          label="Пароль"
          autoComplete="current-password"
          defaultValue="секретный-пароль"
        />
      </>
    ),
  },
  argTypes: {
    children: { control: false },
  },
  decorators: [
    (Story) => (
      <Box maw={420}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof SubmitForm>

export default meta
type Story = StoryObj<typeof meta>

/** Обычное состояние: поля и кнопка отправки во всю ширину. */
export const Default: Story = {}

/** Ошибка от сервера, не привязанная к полю, — сообщение над формой. */
export const WithError: Story = {
  args: { error: 'Неверный e-mail или пароль.' },
}

/** Ошибка сети — у сообщения кнопка «Повторить», введённое остаётся в полях. */
export const NetworkErrorRetry: Story = {
  args: {
    error: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
    retryable: true,
  },
}

/** Ошибка у поля: после отправки фокус переходит на первое поле с ошибкой. */
export const WithFieldError: Story = {
  args: {
    errorsShown: 1,
    children: (
      <>
        <TextInput label="E-mail" type="email" size="md" error="Проверьте формат" />
        <PasswordField
          label="Пароль"
          autoComplete="current-password"
          defaultValue="секретный-пароль"
        />
      </>
    ),
  },
}

/** Идёт отправка: кнопка с индикатором, повторная отправка игнорируется. */
export const Pending: Story = {
  args: { pending: true },
}
