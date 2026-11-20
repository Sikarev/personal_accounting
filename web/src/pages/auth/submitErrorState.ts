import {
  apiErrorText,
  fieldErrorTexts,
  NetworkError,
  type FieldErrorOverrides,
} from '../../shared/api'
import type { Messages } from '../../shared/i18n'

/** Как показать ошибку отправки формы: у полей и (или) сообщением над формой. */
export type SubmitErrorState = {
  fieldErrors: Record<string, string>
  formError: string | null
  retryable: boolean
}

/**
 * Разложить ошибку API по форме. Ошибки известных форме полей — к полям; если нарушение
 * у поля, которого в форме нет (например, `timezone`), или ошибка не про поля — общее
 * сообщение над формой. Ошибка сети — с кнопкой «Повторить»: введённое остаётся в полях.
 */
export function submitErrorState(
  error: unknown,
  t: Messages,
  fields: readonly string[],
  overrides?: FieldErrorOverrides,
): SubmitErrorState {
  const all = fieldErrorTexts(error, t, overrides)
  const fieldErrors: Record<string, string> = {}
  let hasOther = false
  for (const [field, text] of Object.entries(all)) {
    if (fields.includes(field)) fieldErrors[field] = text
    else hasOther = true
  }
  const onlyFields = Object.keys(fieldErrors).length > 0 && !hasOther
  return {
    fieldErrors,
    formError: onlyFields ? null : apiErrorText(error, t),
    retryable: error instanceof NetworkError,
  }
}
