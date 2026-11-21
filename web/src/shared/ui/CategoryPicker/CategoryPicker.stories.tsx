import { Box, Text } from '@mantine/core'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import type { Category } from '../../api'
import { CategoryPicker, type CategoryPickerProps } from './CategoryPicker'

let seq = 0
function cat(name: string, parentId: string | null = null, archived = false): Category {
  seq += 1
  return {
    id: `c${seq}`,
    kind: 'expense',
    parentId,
    name,
    sortOrder: seq,
    archivedAt: archived ? '2026-11-01T00:00:00Z' : null,
  }
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
  ['Транспорт', ['Такси', 'Метро', 'Бензин']],
  ['Дом', ['Коммунальные', 'Ремонт']],
  ['Здоровье', ['Аптека']],
  ['Ёлочные игрушки', []],
])
// Архивные в выборе не показываются.
basic.push(cat('Старое хобби', null, true))

const byName = (list: Category[], name: string) => list.find((c) => c.name === name)!.id
const frequentBasic = ['Продукты', 'Такси', 'Кафе и рестораны', 'Метро', 'Аптека', 'Молочное'].map(
  (n) => byName(basic, n),
)

const long = tree([
  [
    'Образование детей: кружки, секции, репетиторы и летние лагеря в другом городе',
    ['Английский язык с носителем по субботам и воскресеньям'],
  ],
  ['Подарки', ['Дни рождения бабушек, дедушек, тёть и дядь с обеих сторон']],
])

const many = tree(
  Array.from({ length: 24 }, (_, i): [string, string[]] => [
    `Категория ${i + 1}`,
    Array.from({ length: i % 4 }, (_, j) => `Подкатегория ${i + 1}.${j + 1}`),
  ]),
)

type DemoProps = Omit<CategoryPickerProps, 'value' | 'onChange' | 'kind'> & {
  initialValue?: string | null
}

function PickerDemo({ initialValue = null, ...props }: DemoProps) {
  const [value, setValue] = useState<string | null>(initialValue)
  const selected = props.categories.find((c) => c.id === value)
  return (
    <Box maw={420}>
      <CategoryPicker kind="expense" value={value} onChange={setValue} {...props} />
      <Text size="sm" c="dimmed" mt="md">
        Выбрано: {selected?.name ?? '—'}
      </Text>
    </Box>
  )
}

const meta = {
  title: 'UI/CategoryPicker',
  component: PickerDemo,
  args: { categories: basic },
  argTypes: { categories: { control: false } },
  parameters: {
    docs: {
      description: {
        component:
          'Частые категории — чипами (одно касание выбирает), остальные — поиск с автодополнением. ' +
          'Поиск без учёта регистра и «ё/е», находит и подкатегории («такси» → «Транспорт › Такси»). ' +
          'Архивные не показываются. Данные приходят пропсами.',
      },
    },
  },
} satisfies Meta<typeof PickerDemo>

export default meta
type Story = StoryObj<typeof meta>

/** Быстрый ввод: частые категории сверху. */
export const WithFrequent: Story = { args: { frequent: frequentBasic } }

/** Частых ещё нет (новый пользователь): только поиск. */
export const WithoutFrequent: Story = {}

/** Выбрана подкатегория — подсвечен её чип, в поле — «Транспорт › Такси». */
export const Selected: Story = {
  args: { frequent: frequentBasic, initialValue: byName(basic, 'Такси') },
}

/** Поиск по подкатегориям и «ё/е»: «елоч» находит «Ёлочные игрушки». */
export const Search: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Категория'), 'елоч')
    const listbox = within(document.body)
    await expect(await listbox.findByRole('option', { name: 'Ёлочные игрушки' })).toBeVisible()
  },
}

/** Ничего не нашлось. */
export const NothingFound: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('Категория'), 'абырвалг')
  },
}

/** Слияние: без самой категории и её подкатегорий, с ошибкой. */
export const WithExcludeAndError: Story = {
  args: {
    label: 'Куда перенести операции',
    exclude: basic
      .filter((c) => c.name === 'Транспорт' || c.parentId === byName(basic, 'Транспорт'))
      .map((c) => c.id),
    error: 'Выберите категорию, в которую перенести операции',
    required: true,
  },
}

/** Длинные названия: чипы обрезаются многоточием, в списке — переносятся. */
export const LongNames: Story = {
  args: { categories: long, frequent: long.map((c) => c.id) },
}

/** Много категорий: список прокручивается, чипов не больше восьми. */
export const ManyCategories: Story = {
  args: { categories: many, frequent: many.map((c) => c.id) },
}

/** Узкий экран телефона. */
export const Mobile: Story = {
  args: { frequent: frequentBasic },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}
