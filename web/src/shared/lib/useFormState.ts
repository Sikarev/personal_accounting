import { useCallback, useState } from 'react'

/** Ошибки полей формы: путь поля → текст (формат как у `ApiError.fieldErrors`). */
export type FormErrors = Record<string, string>

/**
 * Значения и ошибки небольшой формы. Своя пара десятков строк вместо `@mantine/form`:
 * формам входа хватает «значение, ошибка у поля, сброс ошибки при правке».
 *
 * Правка поля снимает его ошибку: пользователь начал исправлять — красная подпись
 * больше не нужна. Ошибки после отправки (свои и от сервера) — через `showErrors`.
 */
export function useFormState<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<FormErrors>({})
  // Сколько раз форма показала ошибки после отправки: по смене числа форма переводит
  // фокус на первое поле с ошибкой (эффект после рендера, когда ошибки уже в DOM).
  const [errorsShown, setErrorsShown] = useState(0)

  /** Показать ошибки после отправки; если они есть — фокус на первое поле с ошибкой. */
  const showErrors = useCallback((next: FormErrors) => {
    setErrors(next)
    if (Object.keys(next).length > 0) setErrorsShown((n) => n + 1)
  }, [])

  const setValue = useCallback(<K extends keyof T & string>(field: K, value: T[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => {
      if (!Object.hasOwn(prev, field)) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  return { values, errors, setValue, setErrors, showErrors, errorsShown }
}
