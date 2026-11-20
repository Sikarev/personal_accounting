import { Box } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { PasswordField } from './PasswordField'

const meta = {
  title: 'UI/PasswordField',
  component: PasswordField,
  args: {
    label: 'Пароль',
    autoComplete: 'current-password',
    defaultValue: 'секретный-пароль',
  },
  decorators: [
    (Story) => (
      <Box maw={420}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof PasswordField>

export default meta
type Story = StoryObj<typeof meta>

/** Пароль скрыт — состояние по умолчанию. */
export const Hidden: Story = {}

/** Пароль показан кнопкой справа (у кнопки `aria-pressed="true"`). */
export const Visible: Story = {
  args: { defaultVisible: true },
}

/** Пустое поле с подсказкой под подписью — как в регистрации. */
export const WithDescription: Story = {
  args: {
    label: 'Пароль',
    description: 'Не меньше 8 символов',
    autoComplete: 'new-password',
    defaultValue: '',
  },
}

/** Ошибка у поля. */
export const WithError: Story = {
  args: {
    defaultValue: 'корот',
    error: 'Пароль должен быть не короче 8 символов',
    autoComplete: 'new-password',
  },
}

/** Недоступно, пока форма отправляется. */
export const Disabled: Story = {
  args: { disabled: true },
}
