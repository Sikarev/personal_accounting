import { Input, ThemeIcon } from '@mantine/core'
import { IconBan, IconCheck } from '@tabler/icons-react'
import { useId } from 'react'

import { AccountColor } from '../../api'
import { useT } from '../../i18n'
import { icons } from '../../../theme'
import classes from './AccountColorPicker.module.css'

type ColorName = Exclude<AccountColor, null>

/** Цвета в порядке палитры контракта (`AccountColor`). */
const COLORS = Object.values(AccountColor) as ColorName[]

export type AccountColorPickerProps = {
  value: AccountColor | null
  onChange: (value: AccountColor | null) => void
  /** Подпись группы; по умолчанию «Цвет». */
  label?: string
}

/**
 * Выбор цвета счёта: группа образцов-радиокнопок плюс «Без цвета».
 *
 * Внутри — настоящие `<input type="radio">` (визуально скрыты): клавиатура работает
 * как у любой группы радиокнопок — Tab входит в группу на выбранный образец, стрелки
 * переключают. У каждого образца доступное имя — название цвета по-русски; выбранный
 * отмечен галочкой, а не только рамкой (цвет не единственный носитель смысла).
 * Образец — 44 px: зона касания (ux.md, раздел 6).
 */
export function AccountColorPicker({ value, onChange, label }: AccountColorPickerProps) {
  const t = useT()
  const name = useId()
  const labelId = useId()

  const options: { value: AccountColor | null; label: string }[] = [
    { value: null, label: t.accounts.colors.none },
    ...COLORS.map((c) => ({ value: c, label: t.accounts.colors[c] })),
  ]

  return (
    <div>
      <Input.Label id={labelId} size="md" component="div">
        {label ?? t.accounts.form.color}
      </Input.Label>
      <div role="radiogroup" aria-labelledby={labelId} className={classes.group}>
        {options.map((option) => {
          const checked = option.value === value
          return (
            <label key={option.value ?? 'none'} className={classes.option}>
              <input
                type="radio"
                name={name}
                checked={checked}
                onChange={() => onChange(option.value)}
                aria-label={option.label}
                className={classes.input}
              />
              {/* ThemeIcon: фон — токен --mantine-color-<цвет>-filled, а autoContrast
                  делает галочку тёмной на светлых цветах (жёлтый, салатовый). */}
              <ThemeIcon
                aria-hidden
                component="span"
                radius="xl"
                color={option.value ?? 'gray'}
                variant={option.value ? 'filled' : 'default'}
                autoContrast
                className={classes.swatch}
                data-checked={checked || undefined}
              >
                {checked ? (
                  <IconCheck size={icons.size.md} stroke={icons.stroke} />
                ) : (
                  option.value === null && <IconBan size={icons.size.md} stroke={icons.stroke} />
                )}
              </ThemeIcon>
            </label>
          )
        })}
      </div>
    </div>
  )
}
