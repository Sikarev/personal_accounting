import { Button, Stack, Text, TextInput, Title } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { PasswordField } from '../PasswordField/PasswordField'
import { AuthLayout } from './AuthLayout'

const meta = {
  title: 'UI/AuthLayout',
  component: AuthLayout,
  parameters: {
    // Каркас занимает весь экран — без отступов Storybook.
    layout: 'fullscreen',
  },
  args: {
    children: (
      <Stack gap="md">
        <Title order={1} size="xl">
          Вход
        </Title>
        <TextInput size="md" label="E-mail" type="email" autoComplete="email" />
        <PasswordField label="Пароль" autoComplete="current-password" />
        <Button size="md" fullWidth>
          Войти
        </Button>
      </Stack>
    ),
  },
  argTypes: {
    children: { control: false },
  },
} satisfies Meta<typeof AuthLayout>

export default meta
type Story = StoryObj<typeof meta>

/** Форма в карточке по центру экрана (desktop). */
export const Form: Story = {}

/** Мобильная раскладка (viewport телефона): без карточки, во всю ширину, сверху. */
export const Mobile: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}

/** Текстовая страница (документ): карточка шире, строки удобной длины. */
export const Reading: Story = {
  args: {
    width: 'reading',
    children: (
      <Stack gap="md">
        <Title order={1} size="xl">
          Пользовательское соглашение
        </Title>
        <Text>
          Длинный абзац документа. Строка ограничена по ширине, чтобы текст было удобно читать и на
          широком экране, а на телефоне он занимает всю ширину без горизонтальной прокрутки.
        </Text>
      </Stack>
    ),
  },
}
