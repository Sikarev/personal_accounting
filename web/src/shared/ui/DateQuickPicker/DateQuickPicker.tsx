import { Button, Text, TextInput, UnstyledButton } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconCalendar, IconCheck, IconChevronDown } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'

import { useT } from '../../i18n'
import { formatOpDate, isCalendarDate, shiftDate } from '../../lib/date'
import { ResponsiveSheet } from '../ResponsiveSheet/ResponsiveSheet'
import { icons } from '../../../theme'
import classes from './DateQuickPicker.module.css'

export type DateQuickPickerProps = {
  /** Выбранная дата `YYYY-MM-DD`. */
  value: string
  onChange: (date: string) => void
  /**
   * «Сегодня» пользователя (`useToday()` — по часовому поясу профиля, не по часам браузера).
   * Пропсом, а не хуком внутри: компонент не зависит от данных и легко показывается в Storybook.
   */
  today: string
  /** Что выбирается: начало доступного имени кнопки и заголовок окна. По умолчанию «Дата». */
  label?: string
  disabled?: boolean
}

/**
 * Дата операции (ux.md, «Быстрый ввод»: «Счёт и дата показаны компактно и меняются по
 * касанию»). Компактная кнопка «Сегодня ⌄»; по касанию — окно с «Сегодня», «Вчера» и
 * «Другой день» (нативный `<input type="date">`: на телефоне — системный календарь,
 * без `@mantine/dates` и `dayjs`).
 *
 * Клавиатура: Tab по вариантам, Enter — выбрать; в поле даты Enter применяет её.
 */
export function DateQuickPicker({ value, onChange, today, label, disabled }: DateQuickPickerProps) {
  const t = useT()
  const [opened, { open, close }] = useDisclosure(false)
  const yesterday = shiftDate(today, -1)
  const title = label ?? t.datePicker.label
  const buttonText = formatOpDate(value, today)
  const isOther = value !== today && value !== yesterday

  const [other, setOther] = useState(value)
  const [otherError, setOtherError] = useState<string | null>(null)

  const openSheet = () => {
    setOther(value)
    setOtherError(null)
    open()
  }

  const select = (date: string) => {
    onChange(date)
    close()
  }

  const submitOther = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // Окно — в портале, но React-события всплывают по дереву компонентов: без этого
    // отправка формы даты отправила бы и форму операции, в которой стоит пикер.
    event.stopPropagation()
    if (!isCalendarDate(other)) {
      setOtherError(t.datePicker.invalid)
      return
    }
    select(other)
  }

  const renderOption = (date: string, text: string) => {
    const selected = value === date
    return (
      <li>
        <UnstyledButton
          className={classes.option}
          data-selected={selected || undefined}
          aria-pressed={selected}
          data-autofocus={selected || undefined}
          onClick={() => select(date)}
        >
          <Text component="span" className={classes.optionName}>
            {text}
          </Text>
          <span className={classes.check} aria-hidden>
            {selected && <IconCheck size={icons.size.md} stroke={icons.stroke} />}
          </span>
        </UnstyledButton>
      </li>
    )
  }

  return (
    <>
      <UnstyledButton
        className={classes.trigger}
        onClick={openSheet}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-label={`${title}: ${buttonText}`}
      >
        <IconCalendar
          aria-hidden
          size={icons.size.md}
          stroke={icons.stroke}
          className={classes.icon}
        />
        <Text component="span" className={classes.triggerText}>
          {buttonText}
        </Text>
        <IconChevronDown
          aria-hidden
          size={icons.size.md}
          stroke={icons.stroke}
          className={classes.icon}
        />
      </UnstyledButton>

      <ResponsiveSheet opened={opened} onClose={close} title={title} desktopSize="sm">
        <div className={classes.body}>
          <ul className={classes.list}>
            {renderOption(today, t.dates.today)}
            {renderOption(yesterday, t.dates.yesterday)}
          </ul>
          <form className={classes.other} onSubmit={submitOther} noValidate>
            <TextInput
              type="date"
              size="md"
              label={t.datePicker.other}
              value={other}
              onChange={(event) => {
                setOther(event.currentTarget.value)
                setOtherError(null)
              }}
              error={otherError}
              data-autofocus={isOther || undefined}
            />
            <Button type="submit" size="md" variant="default" fullWidth>
              {t.datePicker.apply}
            </Button>
          </form>
        </div>
      </ResponsiveSheet>
    </>
  )
}
