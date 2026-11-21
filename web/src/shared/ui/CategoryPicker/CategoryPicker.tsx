import { Chip, Select, Stack, Text, type ComboboxItem, type OptionsFilter } from '@mantine/core'
import { useId, useMemo, type ReactNode } from 'react'

import type { Category, CategoryKind } from '../../api'
import { useT } from '../../i18n'
import {
  CATEGORY_PATH_SEPARATOR,
  categoryOptions,
  type CategoryOption,
} from '../../lib/categoryTree'
import { matchesSearch } from '../../lib/search'
import classes from './CategoryPicker.module.css'

const NONE: readonly string[] = []

/** Сколько частых категорий показывать чипами (ux.md, «Быстрый ввод»: 6–8). */
export const FREQUENT_LIMIT = 8

export type CategoryPickerProps = {
  /** Категории семьи: можно все сразу — пикер возьмёт активные вида `kind`. */
  categories: readonly Category[]
  kind: CategoryKind
  value: string | null
  onChange: (id: string | null) => void
  /** Id частых категорий по убыванию частоты: первые 6–8 — чипами над полем. */
  frequent?: readonly string[]
  /** Id, которых не должно быть в выборе (например, сама категория при слиянии). */
  exclude?: readonly string[]
  /** Подпись поля; по умолчанию «Категория». */
  label?: string
  /** Текст ошибки под полем. */
  error?: ReactNode
  /** Фокус в поле при открытии окна (`data-autofocus` для Modal/Drawer Mantine). */
  autoFocus?: boolean
  /** Поле обязательно — для подписи и `aria-required`. */
  required?: boolean
}

/**
 * Выбор категории (ux.md, «Быстрый ввод»): частые — чипами, одно касание выбирает;
 * остальные — поле поиска с автодополнением. Поиск идёт и по подкатегориям, без учёта
 * регистра и «ё/е»; подкатегория показана как «Родитель › Подкатегория», выбрать можно и
 * родителя, и подкатегорию. Архивных в выборе нет.
 *
 * Данные не загружает: категории приходят пропсом (экран берёт их из `useListCategories`).
 * Клавиатура — от `Select` Mantine: стрелки, Enter выбирает, Esc закрывает список.
 */
export function CategoryPicker({
  categories,
  kind,
  value,
  onChange,
  frequent = NONE,
  exclude = NONE,
  label,
  error,
  autoFocus,
  required,
}: CategoryPickerProps) {
  const t = useT()
  const frequentLabelId = useId()

  const options = useMemo(
    () => categoryOptions(categories, kind, exclude),
    [categories, kind, exclude],
  )
  const data: ComboboxItem[] = useMemo(
    () => options.map((o) => ({ value: o.id, label: o.label })),
    [options],
  )
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options])
  const chips = useMemo(() => {
    return frequent
      .map((id) => byId.get(id))
      .filter((o) => o !== undefined)
      .slice(0, FREQUENT_LIMIT)
  }, [byId, frequent])

  return (
    <Stack gap="sm">
      {chips.length > 0 && (
        <div role="group" aria-labelledby={frequentLabelId}>
          <Text id={frequentLabelId} size="sm" fw={500} mb="xs">
            {t.categories.picker.frequent}
          </Text>
          <Chip.Group value={value} onChange={(id) => onChange(id)}>
            <div className={classes.chips}>
              {chips.map((o) => (
                <Chip
                  key={o.id}
                  value={o.id}
                  size="md"
                  classNames={{ root: classes.chipRoot, label: classes.chipLabel }}
                >
                  {o.label}
                </Chip>
              ))}
            </div>
          </Chip.Group>
        </div>
      )}
      <Select
        label={label ?? t.categories.picker.search}
        size="md"
        searchable
        data={data}
        value={value}
        onChange={(id) => onChange(id)}
        filter={filterBySearch}
        allowDeselect={false}
        // Список открывается вводом, щелчком или стрелкой вниз, а не самим фокусом: при
        // автофокусе в окне он сразу закрыл бы чипы и кнопку, а диктору — подпись поля.
        openOnFocus={false}
        nothingFoundMessage={t.categories.picker.nothingFound}
        maxDropdownHeight={320}
        error={error}
        required={required}
        data-autofocus={autoFocus || undefined}
        classNames={{ option: classes.option }}
        renderOption={({ option }) => <OptionLabel option={byId.get(option.value)} />}
      />
    </Stack>
  )
}

/** Поиск по полной подписи: «прод» находит и «Продукты», и «Продукты › Молочное». */
const filterBySearch: OptionsFilter = ({ options, search }) =>
  (options as ComboboxItem[]).filter((o) => matchesSearch(o.label, search))

/** У подкатегории имя родителя приглушено: глаз сразу находит само название. */
function OptionLabel({ option }: { option: CategoryOption | undefined }) {
  if (!option) return null
  return (
    <span className={classes.optionText}>
      {option.parentName !== null && (
        <span className={classes.parent}>
          {option.parentName}
          {CATEGORY_PATH_SEPARATOR}
        </span>
      )}
      {option.name}
    </span>
  )
}
