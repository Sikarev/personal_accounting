import {
  Button,
  Chip,
  MultiSelect,
  NativeSelect,
  Paper,
  Text,
  TextInput,
  type ComboboxItem,
  type OptionsFilter,
} from '@mantine/core'
import { useDebouncedCallback } from '@mantine/hooks'
import { IconAdjustmentsHorizontal, IconSearch, IconX } from '@tabler/icons-react'
import { useEffect, useId, useRef, useState } from 'react'

import type { Account, Category, TransactionKind } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { matchesSearch } from '../../shared/lib/search'
import {
  detectPreset,
  FILTER_KINDS,
  PERIOD_PRESETS,
  presetPeriod,
  type FeedFilters,
  type PeriodPreset,
} from '../../shared/lib/transactionFilters'
import { useMobileLayout } from '../../shared/lib/useMobileLayout'
import { ResponsiveSheet } from '../../shared/ui'
import { icons } from '../../theme'
import { accountOptions, categoryFilterOptions, type FilterChip } from './filterOptions'
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

/** Поиск по подписи без учёта регистра и «ё/е», как в выборе категории. */
const filterBySearch: OptionsFilter = ({ options, search }) =>
  options
    .map((o) =>
      'group' in o
        ? { ...o, items: o.items.filter((item) => matchesSearch(item.label, search)) }
        : o,
    )
    .filter((o) =>
      'group' in o ? o.items.length > 0 : matchesSearch((o as ComboboxItem).label, search),
    )

function FilterFields({ filters, onChange, accounts, categories, today, inSheet }: FieldsProps) {
  const t = useT()
  const kindLabelId = useId()
  const comboboxProps = { withinPortal: inSheet === true }

  return (
    <>
      <PeriodField filters={filters} onChange={onChange} today={today} />
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

/**
 * Период: готовые варианты и «Свой период» — два нативных поля даты (на телефоне —
 * системный календарь, без своей библиотеки дат). Границы считаются от «сегодня»
 * пользователя (`useToday()`), не от часов браузера.
 */
function PeriodField({
  filters,
  onChange,
  today,
}: Pick<FieldsProps, 'filters' | 'onChange' | 'today'>) {
  const t = useT()
  const detected = detectPreset(filters, today)
  // «Свой период» выбран, а даты ещё пустые (или совпали с готовым вариантом): поля дат
  // остаются на экране, пока пользователь не выберет другой вариант.
  const [customChosen, setCustomChosen] = useState(detected === 'custom')
  // Период сбросили снаружи (крестик на чипе, «Сбросить всё») — поля дат прячутся.
  const [lastDetected, setLastDetected] = useState(detected)
  if (detected !== lastDetected) {
    setLastDetected(detected)
    if (detected === 'all' && filters.from === null && filters.to === null) setCustomChosen(false)
  }
  const value: PeriodPreset = customChosen ? 'custom' : detected

  const choose = (preset: PeriodPreset) => {
    setCustomChosen(preset === 'custom')
    // «Свой период» начинается с текущих границ: из «Этого месяца» удобно поправить день.
    if (preset !== 'custom') onChange(presetPeriod(preset, today))
  }

  // Начало позже конца — меняем местами: иначе лента молча опустела бы.
  const setFrom = (from: string | null) =>
    from && filters.to && from > filters.to
      ? onChange({ from: filters.to, to: from })
      : onChange({ from })
  const setTo = (to: string | null) =>
    to && filters.from && to < filters.from
      ? onChange({ from: to, to: filters.from })
      : onChange({ to })

  return (
    <div className={classes.period}>
      <NativeSelect
        size="md"
        label={t.feed.filters.period}
        value={value}
        onChange={(e) => choose(e.currentTarget.value as PeriodPreset)}
        data={PERIOD_PRESETS.map((preset) => ({
          value: preset,
          label: t.feed.filters.periods[preset],
        }))}
      />
      {value === 'custom' && (
        <div role="group" aria-label={t.feed.filters.customLabel} className={classes.dates}>
          <TextInput
            type="date"
            size="md"
            label={t.feed.filters.from}
            value={filters.from ?? ''}
            onChange={(e) => setFrom(e.currentTarget.value || null)}
          />
          <TextInput
            type="date"
            size="md"
            label={t.feed.filters.to}
            value={filters.to ?? ''}
            onChange={(e) => setTo(e.currentTarget.value || null)}
          />
        </div>
      )}
    </div>
  )
}

const CHIP = 'data-filter-chip'

/**
 * Активные фильтры чипами над лентой: каждый снимается крестиком, «Сбросить всё».
 * Снятый чип исчезает вместе с фокусом — фокус переходит на соседний чип, а если чипов
 * не осталось, на поле поиска (иначе он упал бы на `body`).
 */
export function ActiveFilterChips({
  chips,
  onChange,
  onReset,
}: {
  chips: FilterChip[]
  onChange: SetFilters
  onReset: () => void
}) {
  const t = useT()
  // Снятый чип (`null` ключ — «Сбросить всё») и его позиция. Фокус ставится, когда чипа
  // уже нет на экране: адрес обновляется не мгновенно, и перерисовка до этого момента
  // нашла бы на прежнем месте тот же чип.
  const pendingFocus = useRef<{ key: string | null; index: number } | null>(null)
  useEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return
    const gone =
      pending.key === null ? chips.length === 0 : !chips.some((c) => c.key === pending.key)
    if (!gone) return
    pendingFocus.current = null
    const rest = document.querySelectorAll<HTMLElement>(`[${CHIP}]`)
    const target = rest[Math.min(pending.index, rest.length - 1)]
    ;(target ?? document.querySelector<HTMLElement>(`[${SEARCH_FIELD}]`))?.focus()
  })

  if (chips.length === 0) return null
  return (
    <div className={classes.activeChips}>
      <ul aria-label={t.feed.filters.activeLabel} className={classes.chipList}>
        {chips.map((chip, index) => (
          <li key={chip.key} className={classes.chipItem}>
            <Button
              variant="light"
              size="sm"
              radius="xl"
              className={classes.activeChip}
              rightSection={<IconX size={icons.size.md} stroke={icons.stroke} aria-hidden />}
              aria-label={t.feed.filters.remove(chip.label)}
              onClick={() => {
                pendingFocus.current = { key: chip.key, index }
                onChange(chip.without)
              }}
              {...{ [CHIP]: true }}
            >
              <span className={classes.activeChipText}>{chip.label}</span>
            </Button>
          </li>
        ))}
      </ul>
      <Button
        variant="subtle"
        size="sm"
        className={classes.touchButton}
        onClick={() => {
          pendingFocus.current = { key: null, index: 0 }
          onReset()
        }}
      >
        {t.feed.resetAll}
      </Button>
    </div>
  )
}
