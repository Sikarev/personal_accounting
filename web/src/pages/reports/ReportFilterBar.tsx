import { Button, MultiSelect, NativeSelect, Paper } from '@mantine/core'
import { IconAdjustmentsHorizontal } from '@tabler/icons-react'
import { useState } from 'react'

import type { Account } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { accountOptions, filterBySearch } from '../../shared/lib/selectOptions'
import { useMobileLayout } from '../../shared/lib/useMobileLayout'
import { PeriodField, ResponsiveSheet } from '../../shared/ui'
import { icons } from '../../theme'
import {
  REPORT_PRESETS,
  type ReportDefaultPreset,
  type ReportFilters,
  type ReportFiltersPatch,
} from './reportFilters'
import classes from './ReportsPage.module.css'

/** Атрибут блока фильтров: в поле периода уходит фокус, когда сняли последний чип. */
export const REPORT_FILTERS = 'data-report-filters'

type Props = {
  filters: ReportFilters
  onChange: (patch: ReportFiltersPatch) => void
  accounts: readonly Account[]
  today: string
  /** В семье больше одного человека — есть фильтр «Чьи операции». */
  withAuthors: boolean
  meId: string | undefined
  /** Период вкладки по умолчанию: к нему возвращает крестик чипа периода. */
  defaultPreset: ReportDefaultPreset
}

/**
 * Фильтры отчёта (requirements 5.10): период, счета, участник. Изменения применяются сразу,
 * адрес всегда совпадает с показанным отчётом.
 *
 * Desktop — панель над отчётом, как у ленты. Mobile — период на виду (его меняют чаще
 * всего), счета и участник — в нижней панели по кнопке «Фильтры».
 */
export function ReportFilterBar(props: Props) {
  const t = useT()
  const mobile = useMobileLayout()
  const [opened, setOpened] = useState(false)
  const { filters, onChange, today } = props

  const period = (
    <PeriodField
      value={filters}
      onChange={onChange}
      today={today}
      presets={REPORT_PRESETS}
      defaultPreset={props.defaultPreset}
      required
    />
  )

  if (!mobile) {
    return (
      <Paper
        withBorder
        radius="lg"
        p="md"
        component="section"
        aria-label={t.reports.filters.label}
        {...{ [REPORT_FILTERS]: true }}
      >
        <div className={classes.filterGrid}>
          {period}
          <ExtraFields {...props} />
        </div>
      </Paper>
    )
  }

  const count = filters.accountId.length + (filters.authorId.length > 0 ? 1 : 0)
  return (
    <section
      aria-label={t.reports.filters.label}
      className={classes.mobileBar}
      {...{ [REPORT_FILTERS]: true }}
    >
      <div className={classes.mobilePeriod}>{period}</div>
      <Button
        variant="default"
        size="md"
        className={classes.touchButton}
        leftSection={<IconAdjustmentsHorizontal size={icons.size.md} stroke={icons.stroke} />}
        onClick={() => setOpened(true)}
      >
        {count > 0 ? t.reports.filters.openWithCount(count) : t.reports.filters.open}
      </Button>
      <ResponsiveSheet
        opened={opened}
        onClose={() => setOpened(false)}
        title={t.reports.filters.title}
        // На всю высоту: выпадающий список внутри панели по высоте содержимого
        // зацикливает пересчёт размеров (техдолг №36).
        fullHeight
      >
        <div className={classes.sheetFields}>
          <ExtraFields {...props} inSheet />
          <Button size="md" fullWidth onClick={() => setOpened(false)}>
            {t.reports.filters.apply}
          </Button>
        </div>
      </ResponsiveSheet>
    </section>
  )
}

type AuthorChoice = 'all' | 'mine' | 'other'

/** Счета и участник. */
function ExtraFields({
  filters,
  onChange,
  accounts,
  withAuthors,
  meId,
  inSheet,
}: Props & { inSheet?: boolean }) {
  const t = useT()
  // Участников семьи API пока не отдаёт (появятся на этапе 5): выбор — «все» или «мои».
  // Другой автор может прийти только из адреса — тогда он показан отдельным вариантом.
  const author: AuthorChoice =
    filters.authorId.length === 0
      ? 'all'
      : filters.authorId.length === 1 && filters.authorId[0] === meId
        ? 'mine'
        : 'other'
  const authorChoices: AuthorChoice[] =
    author === 'other' ? ['all', 'mine', 'other'] : ['all', 'mine']

  return (
    <>
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
        comboboxProps={{ withinPortal: inSheet === true }}
        clearButtonProps={{ 'aria-label': t.feed.filters.clear(t.feed.filters.accounts) }}
      />
      {withAuthors && meId && (
        <NativeSelect
          size="md"
          label={t.reports.filters.author}
          value={author}
          onChange={(e) => {
            const choice = e.currentTarget.value as AuthorChoice
            if (choice === 'all') onChange({ authorId: [] })
            else if (choice === 'mine') onChange({ authorId: [meId] })
          }}
          data={authorChoices.map((choice) => ({
            value: choice,
            label: t.reports.filters.authors[choice],
          }))}
        />
      )}
    </>
  )
}
