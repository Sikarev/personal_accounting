import { Button, Paper } from '@mantine/core'
import { IconListDetails, IconPlus, IconSearch, IconWifiOff } from '@tabler/icons-react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import { icons } from '../../../theme'
import { EmptyState } from './EmptyState'

const meta = {
  title: 'UI/EmptyState',
  component: EmptyState,
  args: {
    icon: IconListDetails,
    title: 'Здесь появятся ваши операции',
    description: 'Расходы, доходы и переводы — по дням, с поиском и фильтрами.',
  },
  argTypes: {
    icon: { control: false },
    action: { control: false },
  },
  decorators: [
    (Story) => (
      <Paper withBorder radius="lg" maw={640}>
        <Story />
      </Paper>
    ),
  ],
} satisfies Meta<typeof EmptyState>

export default meta
type Story = StoryObj<typeof meta>

/** Пустой экран с главным действием — основной вариант. */
export const WithAction: Story = {
  args: {
    action: (
      <Button leftSection={<IconPlus size={icons.size.md} stroke={2} />}>
        Добавить первую операцию
      </Button>
    ),
  },
}

/** Без действия: когда сделать пока нечего (раздел в разработке, отчёт без данных). */
export const WithoutAction: Story = {}

/** Только заголовок. */
export const TitleOnly: Story = {
  args: { description: undefined, icon: IconSearch, title: 'Ничего не нашлось' },
}

/** Ошибка: что случилось и что делать. */
export const ErrorState: Story = {
  args: {
    icon: IconWifiOff,
    title: 'Не удалось загрузить операции',
    description: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.',
    action: <Button variant="light">Повторить</Button>,
  },
}

/** Длинный текст в узком контейнере не ломает вёрстку. */
export const NarrowContainer: Story = {
  decorators: [
    (Story) => (
      <Paper withBorder radius="lg" maw={320}>
        <Story />
      </Paper>
    ),
  ],
  args: {
    title: 'Очень длинный заголовок пустого состояния, который переносится на несколько строк',
    description:
      'И такое же длинное описание: оно ограничено по ширине, чтобы строки оставались удобными для чтения.',
  },
}
