import { NativeSelect, TextInput } from '@mantine/core'
import { useRef, useState } from 'react'

import { useT } from '../../i18n'
import { isCalendarDate } from '../../lib/date'
import {
  detectPreset,
  presetPeriod,
  type Period,
  type PeriodPreset,
} from '../../lib/transactionFilters'
import classes from './PeriodField.module.css'

export type PeriodFieldProps = {
  /** Текущие границы (`null` — без границы). */
  value: Period
  /** Новые границы — только изменившиеся. */
  onChange: (patch: Partial<Period>) => void
  /** «Сегодня» пользователя (`useToday()`): от него считаются готовые периоды. */
  today: string
  /** Какие варианты предлагать, по порядку. */
  presets: readonly PeriodPreset[]
  /**
   * Вариант по умолчанию: к нему период возвращают снаружи (крестик на чипе, «Сбросить
   * всё») — тогда поля дат прячутся. Лента — «Всё время», отчёты — «Этот месяц»
   * (по категориям) или «12 месяцев» (по месяцам, баланс).
   */
  defaultPreset: PeriodPreset
  /**
   * Границы обязательны (отчёты): очищенное поле даты возвращает прежнее значение,
   * а не снимает границу.
   */
  required?: boolean
}

/**
 * Период: готовые варианты и «Свой период» — два нативных поля даты (на телефоне —
 * системный календарь, без своей библиотеки дат). Границы считаются от «сегодня»
 * пользователя (`useToday()`), не от часов браузера. Общий для ленты и отчётов.
 */
export function PeriodField({
  value: period,
  onChange,
  today,
  presets,
  defaultPreset,
  required = false,
}: PeriodFieldProps) {
  const t = useT()
  const detected = detectPreset(period, today, presets)
  // «Свой период» выбран, а даты ещё пустые (или совпали с готовым вариантом): поля дат
  // остаются на экране, пока пользователь не выберет другой вариант.
  const [customChosen, setCustomChosen] = useState(detected === 'custom')
  // Период сбросили снаружи (крестик на чипе, «Сбросить всё») — поля дат прячутся.
  const [lastDetected, setLastDetected] = useState(detected)
  if (detected !== lastDetected) {
    setLastDetected(detected)
    if (detected === defaultPreset) setCustomChosen(false)
  }
  const value: PeriodPreset = customChosen ? 'custom' : detected

  const choose = (preset: PeriodPreset) => {
    setCustomChosen(preset === 'custom')
    // «Свой период» начинается с текущих границ: из «Этого месяца» удобно поправить день.
    if (preset !== 'custom') onChange(presetPeriod(preset, today))
  }

  // Начало позже конца — меняем местами: иначе выборка молча опустела бы. Сюда приходят
  // только законченные даты (DateField), поэтому перестановка не ломает набор.
  const setFrom = (from: string | null) =>
    from && period.to && from > period.to
      ? onChange({ from: period.to, to: from })
      : onChange({ from })
  const setTo = (to: string | null) =>
    to && period.from && to < period.from
      ? onChange({ from: to, to: period.from })
      : onChange({ to })

  return (
    <div className={classes.period}>
      <NativeSelect
        size="md"
        label={t.feed.filters.period}
        value={value}
        onChange={(e) => choose(e.currentTarget.value as PeriodPreset)}
        data={presets.map((preset) => ({
          value: preset,
          label: t.feed.filters.periods[preset],
        }))}
      />
      {value === 'custom' && (
        <div role="group" aria-label={t.feed.filters.customLabel} className={classes.dates}>
          <DateField
            label={t.feed.filters.from}
            value={period.from}
            onCommit={setFrom}
            required={required}
          />
          <DateField
            label={t.feed.filters.to}
            value={period.to}
            onCommit={setTo}
            required={required}
          />
        </div>
      )}
    </div>
  )
}

/** Год, с которого дата считается законченной: при наборе Chrome отдаёт `0002-…`. */
const MIN_YEAR = 1900

const isFinishedDate = (value: string) =>
  isCalendarDate(value) && Number(value.slice(0, 4)) >= MIN_YEAR

/**
 * Поле даты границы периода. Значение — своё состояние, в адрес уходит в два момента:
 * - выбор в календаре (или колесе на телефоне) — сразу: дата приходит законченной;
 * - набор с клавиатуры — по Enter или уходу из поля. Пока набирается, браузер отдаёт
 *   промежуточные даты: `0002-12-12`, а в уже заполненном поле — вполне правдоподобную
 *   `2026-01-22` на полпути к `2026-11-22`. Запись каждой в адрес запускала бы запрос
 *   и перестановку «начало позже конца» — набранное терялось бы.
 * При применении пустое поле снимает границу (если она не обязательна), недонабранное —
 * возвращает прежнее значение.
 */
function DateField({
  label,
  value,
  onCommit,
  required,
}: {
  label: string
  value: string | null
  onCommit: (value: string | null) => void
  required: boolean
}) {
  const [draft, setDraft] = useState(value ?? '')
  // Значение в адресе поменялось снаружи (перестановка, готовый период, чип) — показываем его.
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setDraft(value ?? '')
  }
  // Идёт набор с клавиатуры: изменения ждут Enter или ухода из поля.
  const typing = useRef(false)

  const apply = (next: string) => {
    typing.current = false
    if (next === '') {
      if (required) setDraft(value ?? '')
      else if (value !== null) onCommit(null)
    } else if (!isFinishedDate(next)) {
      setDraft(value ?? '')
    } else if (next !== value) {
      onCommit(next)
    }
  }

  return (
    <TextInput
      type="date"
      size="md"
      label={label}
      value={draft}
      onChange={(e) => {
        const next = e.currentTarget.value
        setDraft(next)
        if (!typing.current && isFinishedDate(next)) apply(next)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') apply(e.currentTarget.value)
        else if (e.key !== 'Tab' && e.key !== 'Escape') typing.current = true
      }}
      onBlur={(e) => {
        if (typing.current || e.currentTarget.value === '') apply(e.currentTarget.value)
      }}
    />
  )
}
