import { Alert, Button, Stack } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { useEffect, useRef, type FormEvent, type ReactNode } from 'react'

import { useT } from '../../shared/i18n'
import { icons } from '../../theme'

/**
 * Общее для форм входа, регистрации и восстановления пароля: сообщение над формой,
 * фокус на первом поле с ошибкой, кнопка отправки во всю ширину.
 *
 * Форма с `noValidate`: проверку и тексты ошибок даём сами (из словаря), а не
 * всплывающие подсказки браузера на его языке.
 */
export function AuthForm({
  onSubmit,
  errorsShown,
  error,
  retryable,
  submitLabel,
  pending,
  children,
}: {
  onSubmit: () => void
  /**
   * Счётчик показов ошибок (`useFormState().errorsShown`): при его смене фокус переходит
   * на первое поле с ошибкой — и пользователь клавиатуры, и экранный диктор сразу попадают
   * туда, что нужно исправить.
   */
  errorsShown: number
  /** Сообщение над формой (неверный пароль, лимит, нет связи). */
  error: string | null
  /** Показать у сообщения кнопку «Повторить» (ошибка сети). */
  retryable?: boolean
  submitLabel: string
  pending: boolean
  children: ReactNode
}) {
  const t = useT()
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (errorsShown === 0) return
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [errorsShown])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    onSubmit()
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate>
      <Stack gap="md">
        {error && (
          <Alert
            color="red"
            variant="light"
            role="alert"
            icon={<IconAlertCircle size={icons.size.md} stroke={icons.stroke} />}
          >
            <Stack gap="sm" align="flex-start">
              {error}
              {retryable && (
                <Button
                  variant="default"
                  size="md"
                  onClick={() => formRef.current?.requestSubmit()}
                >
                  {t.errors.retry}
                </Button>
              )}
            </Stack>
          </Alert>
        )}
        {children}
        <Button type="submit" size="md" fullWidth loading={pending}>
          {submitLabel}
        </Button>
      </Stack>
    </form>
  )
}
