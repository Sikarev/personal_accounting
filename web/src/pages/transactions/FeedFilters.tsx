import { Button, Chip, MultiSelect, Paper, Text, TextInput } from '@mantine/core'
import { useDebouncedCallback } from '@mantine/hooks'
import { IconAdjustmentsHorizontal, IconSearch } from '@tabler/icons-react'
import { useId, useState } from 'react'

import type { Account, Category, TransactionKind } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { accountOptions, filterBySearch } from '../../shared/lib/selectOptions'
import { FILTER_KINDS, PERIOD_PRESETS, type FeedFilters } from '../../shared/lib/transactionFilters'
import { useMobileLayout } from '../../shared/lib/useMobileLayout'
import { PeriodField, ResponsiveSheet } from '../../shared/ui'
import { icons } from '../../theme'
import { categoryFilterOptions } from './filterOptions'
import { SEARCH_FIELD } from './focusTargets'
import classes from './TransactionsPage.module.css'

export type SetFilters = (patch: Partial<FeedFilters>) => void

/** Значение поля поиска, заданное снаружи; новая `epoch` пересоздаёт поле. */
export type SearchState = { epoch: number; value: string }

/** Задержка поиска: запрос уходит, когда пользователь перестал печатать. */
const SEARCH_DEBOUNCE_MS = 300

type FieldsProps = {
  filters: FeedFilters
  onChange: SetFilters
  accounts: readonly Account[]
  categories: readonly Category[]
  today: string
  /** Поля внутри окна (mobile): выпадающие списки — в портале поверх окна. */
  inSheet?: boolean
}

/**
 * Фильтры ленты (requirements 5.8). На desktop — панель над лентой: фильтров немного,
 * и в колонке сбоку строкам ленты осталось бы мало места. На mobile — поиск сверху
 * и кнопка «Фильтры», открывающая остальное в нижней панели.
 *
 * Изменения применяются сразу, без кнопки «Применить»: лента обновляется на глазах,
 * а адрес страницы всегда совпадает с тем, что показано.
 */
export function FeedFilterBar(
  props: Omit<FieldsProps, 'inSheet'> & {
    /** Сколько фильтров задано в панели (без поиска) — число на кнопке «Фильтры». */
    chipCount: number
    search: SearchState
    /** Запись поиска в адрес — без пересоздания поля (в отличие от `onChange`). */
    onSearch: SetFilters
  },
) {
  const t = useT()
  const mobile = useMobileLayout()
  const [opened, setOpened] = useState(false)
  const { chipCount, search, onSearch, ...fields } = props
  const searchField = <SearchField key={search.epoch} initial={search.value} onChange={onSearch} />

  if (!mobile) {
    return (
      <Paper withBorder radius="lg" p="md" component="section" aria-label={t.feed.filters.label}>
        <div className={classes.filterGrid}>
          {searchField}
          <FilterFields {...fields} />
        </div>
      </Paper>
    )
  }

  const filterCount = chipCount
  return (
    <section aria-label={t.feed.filters.label} className={classes.mobileBar}>
      <div className={classes.mobileSearch}>{searchField}</div>
      <Button
        variant="default"
        size="md"
        className={classes.touchButton}
        leftSection={<IconAdjustmentsHorizontal size={icons.size.md} stroke={icons.stroke} />}
        onClick={() => setOpened(true)}
      >
        {filterCount > 0 ? t.feed.filters.openWithCount(filterCount) : t.feed.filters.open}
      </Button>
      <ResponsiveSheet
        opened={opened}
        onClose={() => setOpened(false)}
        title={t.feed.filters.title}
        // На всю высоту: выпадающий список внутри панели по высоте содержимого
        // зацикливает пересчёт размеров (техдолг №36).
        fullHeight
      >
        <div className={classes.sheetFields}>
          <FilterFields {...fields} inSheet />
          <Button size="md" fullWidth onClick={() => setOpened(false)}>
            {t.feed.filters.apply}
          </Button>
        </div>
      </ResponsiveSheet>
    </section>
  )
}

/**
 * Поле поиска: текст — своё состояние, в адрес он уходит с задержкой, когда ввод затих
 * (запрос к API — по адресу). Привязать поле прямо к адресу нельзя: адрес обновляется
 * не мгновенно, и при быстром наборе буквы терялись бы.
 *
 * Снаружи поиск меняют крестик на чипе и «Сбросить» — тогда поле пересоздаётся с новым
 * значением (`SearchState.epoch` — ключ), а недописанный ввод не уйдёт в адрес.
 */
function SearchField({ initial, onChange }: { initial: string; onChange: SetFilters }) {
  const t = useT()
  const [value, setValue] = useState(initial)
  const commit = useDebouncedCallback((q: string) => onChange({ q }), SEARCH_DEBOUNCE_MS)
  return (
    <TextInput
      type="search"
      size="md"
      label={t.feed.filters.search}
      value={value}
      onChange={(e) => {
        setValue(e.currentTarget.value)
        commit(e.currentTarget.value)
      }}
      leftSection={<IconSearch size={icons.size.md} stroke={icons.stroke} />}
      maxLength={200}
      {...{ [SEARCH_FIELD]: true }}
    />
  )
}

function FilterFields({ filters, onChange, accounts, categories, today, inSheet }: FieldsProps) {
  const t = useT()
  const kindLabelId = useId()
  const comboboxProps = { withinPortal: inSheet === true }

  return (
    <>
      <PeriodField
        value={filters}
        onChange={onChange}
        today={today}
        presets={PERIOD_PRESETS}
        defaultPreset="all"
      />
      <MultiSelect
        size="md"
        label={t.feed.filters.accounts}
        data={accountOptions(accounts, t)}
        value={filters.accountId}
        onChange={(accountId) => onChange({ accountId })}
        searchable
        clearable
        filter={filterBySearch}
        nothingFoundMessage={t.feed.filters.nothingFound}
        comboboxProps={comboboxProps}
        clearButtonProps={{ 'aria-label': t.feed.filters.clear(t.feed.filters.accounts) }}
      />
      <MultiSelect
        size="md"
        label={t.feed.filters.categories}
        data={categoryFilterOptions(categories, t)}
        value={filters.categoryId}
        onChange={(categoryId) => onChange({ categoryId })}
        searchable
        clearable
        filter={filterBySearch}
        nothingFoundMessage={t.feed.filters.nothingFound}
        comboboxProps={comboboxProps}
        clearButtonProps={{ 'aria-label': t.feed.filters.clear(t.feed.filters.categories) }}
      />
      <div role="group" aria-labelledby={kindLabelId} className={classes.kinds}>
        {/* Как подписи полей size="md" рядом. */}
        <Text id={kindLabelId} size="md" fw={500} mb="xs">
          {t.feed.filters.kind}
        </Text>
        <Chip.Group
          multiple
          value={filters.kind}
          onChange={(kind) => onChange({ kind: kind as TransactionKind[] })}
        >
          <div className={classes.chips}>
            {FILTER_KINDS.map((kind) => (
              <Chip key={kind} value={kind} size="md" classNames={{ label: classes.chipLabel }}>
                {t.feed.filters.kinds[kind]}
              </Chip>
            ))}
          </div>
        </Chip.Group>
      </div>
    </>
  )
}
