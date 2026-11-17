import { Box, Button, Stack, Text, TextInput } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconBolt } from '@tabler/icons-react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { EmptyState } from '../EmptyState/EmptyState'
import { ResponsiveSheet, type ResponsiveSheetProps } from './ResponsiveSheet'

type DemoProps = Pick<ResponsiveSheetProps, 'fullHeight' | 'desktopSize'> & {
  initiallyOpened?: boolean
  content?: 'empty' | 'form'
}

function SheetDemo({ initiallyOpened = false, content = 'empty', ...props }: DemoProps) {
  const [opened, { open, close }] = useDisclosure(initiallyOpened)

  return (
    <Box p="md">
      <Button onClick={open}>Открыть панель</Button>
      <ResponsiveSheet opened={opened} onClose={close} title="Новая операция" {...props}>
        {content === 'empty' ? (
          <EmptyState
            icon={IconBolt}
            titleOrder={3}
            title="Быстрый ввод скоро появится"
            description="Здесь можно будет внести расход или доход за несколько секунд."
          />
        ) : (
          <Stack gap="md">
            <TextInput label="Сумма" inputMode="decimal" data-autofocus />
            <TextInput label="Комментарий" />
            <Text size="sm" c="dimmed">
              Esc или клик по затемнению закрывает панель, фокус возвращается на кнопку.
            </Text>
            <Button onClick={close}>Сохранить расход</Button>
          </Stack>
        )}
      </ResponsiveSheet>
    </Box>
  )
}

const meta = {
  title: 'UI/ResponsiveSheet',
  component: SheetDemo,
  args: { initiallyOpened: true, content: 'empty', fullHeight: false, desktopSize: 'md' },
  argTypes: {
    content: { control: 'inline-radio', options: ['empty', 'form'] },
    desktopSize: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
  parameters: {
    // Окно Mantine позиционируется от левого края body; отступ «padded» сдвинул бы его.
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'На экранах уже 768 px — bottom sheet, шире — модальное окно. Переключите ширину окна (Viewport), чтобы увидеть оба варианта.',
      },
    },
  },
} satisfies Meta<typeof SheetDemo>

export default meta
type Story = StoryObj<typeof meta>

/** Панель открыта, внутри — пустое состояние (как заглушка быстрого ввода). */
export const Opened: Story = {}

/** С формой: фокус сразу в первом поле (`data-autofocus`). */
export const WithForm: Story = { args: { content: 'form' } }

/** На mobile — на всю высоту экрана (будущая форма быстрого ввода). */
export const FullHeightOnMobile: Story = {
  args: { content: 'form', fullHeight: true },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}

/** Закрыта: откройте кнопкой и закройте Esc — фокус вернётся на кнопку. */
export const Closed: Story = { args: { initiallyOpened: false } }
