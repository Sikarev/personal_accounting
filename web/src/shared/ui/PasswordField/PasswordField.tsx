import { PasswordInput, type PasswordInputProps } from '@mantine/core'

import { useT } from '../../i18n'
import classes from './PasswordField.module.css'

export type PasswordFieldProps = Omit<PasswordInputProps, 'autoComplete'> & {
  /**
   * Обязателен: по нему менеджер паролей понимает, что делать с полем.
   * `current-password` — вход, `new-password` — регистрация и новый пароль.
   */
  autoComplete: 'current-password' | 'new-password'
}

/**
 * Поле пароля с кнопкой «Показать пароль».
 *
 * Отличия от `PasswordInput` Mantine:
 * - кнопка доступна с клавиатуры (у Mantine по умолчанию `tabIndex=-1`) и подписана
 *   по-русски; состояние «показан/скрыт» передаёт `aria-pressed`, подпись не меняется;
 * - зона касания кнопки — во всю высоту поля и не уже 44 px;
 * - размер `md`: шрифт 16 px, iOS не увеличивает страницу при фокусе.
 */
export function PasswordField({ size = 'md', ...props }: PasswordFieldProps) {
  const t = useT()
  return (
    <PasswordInput
      size={size}
      visibilityToggleFocusable
      visibilityToggleButtonProps={{ 'aria-label': t.auth.showPassword }}
      rightSectionWidth="var(--app-touch-target)"
      classNames={{ visibilityToggle: classes.toggle }}
      {...props}
    />
  )
}
