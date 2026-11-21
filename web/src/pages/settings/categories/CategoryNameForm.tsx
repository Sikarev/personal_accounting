import { Alert, Button, Stack, TextInput } from '@mantine/core'
import { IconAlertCircle } from '@tabler/icons-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { apiErrorText, fieldErrorTexts } from '../../../shared/api'
import { useT } from '../../../shared/i18n'
import { useFormState } from '../../../shared/lib/useFormState'
import { icons } from '../../../theme'
import { categoryErrorOverrides } from './categoryErrors'

/** Ограничение API (docs/api.md → «Категории»): 1–60 символов после обрезки пробелов. */
export const CATEGORY_NAME_MAX = 60

/**
 * Форма с одним полем «Название» — для создания и переименования категории (внутри
 * `ResponsiveSheet`). Проверяет имя сама, ошибки сервера показывает у поля по коду
 * нарушения (`name_taken` и т. п.), остальное — сообщением над полем.
 */
export function CategoryNameForm({
  initialName = '',
  submitLabel,
  onSubmit,
}: {
  initialName?: string
  submitLabel: string
  /** Сохранить; промис отклоняется ошибкой API — форма покажет её и не закроется. */
  onSubmit: (name: string) => Promise<unknown>
}) {
  const t = useT()
  const form = useFormState({ name: initialName })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // После ошибки фокус возвращается в поле: диктор прочитает ошибку, можно сразу исправлять.
  useEffect(() => {
    if (form.errorsShown > 0) inputRef.current?.focus()
  }, [form.errorsShown])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    const name = form.values.name.trim()
    if (name === '') return form.showErrors({ name: t.categories.form.nameRequired })
    // Символы, а не UTF-16: эмодзи считается одним, как на сервере.
    if ([...name].length > CATEGORY_NAME_MAX)
      return form.showErrors({ name: t.categories.form.nameTooLong })

    setPending(true)
    setError(null)
    try {
      await onSubmit(name)
    } catch (e) {
      const fields = fieldErrorTexts(e, t, categoryErrorOverrides(t))
      if (fields.name) form.showErrors({ name: fields.name })
      else setError(fields.parentId ?? apiErrorText(e, t))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stack gap="md">
        {error && (
          <Alert
            color="red"
            variant="light"
            role="alert"
            icon={<IconAlertCircle size={icons.size.md} stroke={icons.stroke} />}
          >
            {error}
          </Alert>
        )}
        <TextInput
          ref={inputRef}
          label={t.categories.form.name}
          size="md"
          value={form.values.name}
          onChange={(e) => form.setValue('name', e.currentTarget.value)}
          error={form.errors.name}
          // Своя проверка длины с понятным текстом; maxLength браузера молча обрезал бы ввод.
          autoComplete="off"
          data-autofocus
          required
        />
        <Button type="submit" size="md" fullWidth loading={pending}>
          {submitLabel}
        </Button>
      </Stack>
    </form>
  )
}
