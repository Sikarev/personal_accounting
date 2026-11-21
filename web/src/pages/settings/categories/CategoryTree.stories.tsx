import { Box, Paper, Text } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import type { Category } from '../../../shared/api'
import { activeTree, applyMove, toMoveIndex } from '../../../shared/lib/categoryTree'
import { CategoryTree } from './CategoryTree'
import { CategoryTreeSkeleton } from './CategoryTreeSkeleton'

let seq = 0
function cat(name: string, parentId: string | null = null): Category {
  seq += 1
  return { id: `c${seq}`, kind: 'expense', parentId, name, sortOrder: seq, archivedAt: null }
}

function tree(spec: [string, string[]][]): Category[] {
  return spec.flatMap(([name, children]) => {
    const parent = cat(name)
    return [parent, ...children.map((c) => cat(c, parent.id))]
  })
}

const basic = tree([
  ['Продукты', ['Молочное', 'Овощи и фрукты']],
  ['Кафе и рестораны', []],
  ['Транспорт', ['Такси', 'Метро']],
  ['Подарки', []],
])

const long = tree([
  ['Образование детей: кружки, секции, репетиторы и летние лагеря в другом городе', []],
  ['Подарки', ['Дни рождения бабушек, дедушек, тёть и дядь с обеих сторон']],
])

const many = tree(
  Array.from({ length: 20 }, (_, i): [string, string[]] => [
    `Категория ${i + 1}`,
    Array.from({ length: i % 3 }, (_, j) => `Подкатегория ${i + 1}.${j + 1}`),
  ]),
)

/** Дерево с «сервером» в памяти: перемещение применяется так же, как на экране. */
function TreeDemo({ initial }: { initial: Category[] }) {
  const [list, setList] = useState(initial)
  const [log, setLog] = useState('—')
  return (
    <Box maw={640}>
      <Paper withBorder radius="lg">
        <CategoryTree
          nodes={activeTree(list, 'expense')}
          label="Категории расходов"
          onMove={({ id, parentId, visibleIndex }) => {
            const index = toMoveIndex(list, id, parentId, visibleIndex)
            setList((l) => applyMove(l, id, parentId, index))
            setLog(`move ${id} → parentId ${parentId ?? 'null'}, index ${index}`)
          }}
          onAction={(action, category) => setLog(`${action}: ${category.name}`)}
        />
      </Paper>
      <Text size="sm" c="dimmed" mt="md">
        Последнее действие: {log}
      </Text>
    </Box>
  )
}

const meta = {
  title: 'Экраны/Категории/CategoryTree',
  component: TreeDemo,
  args: { initial: basic },
  argTypes: { initial: { control: false } },
  parameters: {
    docs: {
      description: {
        component:
          'Перетаскивание за ручку: вверх/вниз — порядок, вправо/влево — уровень (подкатегория / верхний уровень). ' +
          'С клавиатуры: Tab до ручки, пробел — взять, стрелки, пробел — положить, Esc — отменить. ' +
          'Категорию с подкатегориями вложить нельзя. Меню «⋮» — остальные действия.',
      },
    },
  },
} satisfies Meta<typeof TreeDemo>

export default meta
type Story = StoryObj<typeof meta>

/** Обычное дерево с подкатегориями. */
export const Default: Story = {}

/** Длинные названия обрезаются многоточием. */
export const LongNames: Story = { args: { initial: long } }

/** Много категорий. */
export const Many: Story = { args: { initial: many } }

/** Узкий экран телефона. */
export const Mobile: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}

/** Скелетон загрузки в форме дерева. */
export const Loading: Story = {
  render: () => (
    <Box maw={640}>
      <CategoryTreeSkeleton />
    </Box>
  ),
}
