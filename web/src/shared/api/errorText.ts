import type { Messages } from '../i18n'
import { formatCount } from '../lib/plural'
import { ApiError, NetworkError } from './http'

/**
 * Тексты ошибок API для пользователя (CLAUDE.md → «Фронтенд»): выбираются по `code`,
 * неизвестный код — по HTTP-статусу. `detail` сервера не показывается: он для разработчика.
 */

/** «Попробуйте через 2 минуты»: секунды из `Retry-After` округляются вверх до минут. */
export function tooManyRequestsText(retryAfterSeconds: number | undefined, t: Messages): string {
  if (retryAfterSeconds === undefined) return t.errors.tooManyRequestsLater
  // Меньше минуты — всё равно «1 минуту»: секунды в таком сообщении — лишняя точность.
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
  return t.errors.tooManyRequests(formatCount(minutes, t.errors.minutes))
}

/** Общий текст ошибки: для сообщения над формой, тоста или экрана ошибки. */
export function apiErrorText(error: unknown, t: Messages): string {
  if (error instanceof NetworkError) return t.errors.network
  if (!(error instanceof ApiError)) return t.errors.generic

  switch (error.code) {
    case 'invalid_credentials':
      return t.errors.invalidCredentials
    case 'too_many_requests':
      return tooManyRequestsText(error.retryAfterSeconds, t)
    case 'unauthorized':
      return t.errors.sessionExpired
    case 'forbidden_origin':
      return t.errors.forbiddenOrigin
    case 'validation_failed':
      return t.errors.validation
    case 'not_found':
      return t.errors.notFound
  }

  // Код неизвестен (новый в контракте или ответ не от нашего API) — решаем по статусу.
  if (error.status === 429) return tooManyRequestsText(error.retryAfterSeconds, t)
  if (error.status === 401) return t.errors.sessionExpired
  if (error.status === 404) return t.errors.notFound
  if (error.status === 422) return t.errors.validation
  if (error.status >= 500) return t.errors.server
  return t.errors.generic
}

/** Тексты для отдельных полей и кодов нарушений: `{ email: { invalid_format: '…' } }`. */
export type FieldErrorOverrides = Record<string, Record<string, string>>

/**
 * Ошибки полей из 422 `validation_failed` → `{ поле: текст }` для формы.
 * Текст выбирается по коду нарушения (`errors[].code`): сначала из `overrides` для этого
 * поля, затем общий по коду. Сообщение сервера (`message`) не показывается — как и `detail`,
 * оно не из словаря. У поля одна строка ошибки — берётся первое нарушение.
 */
export function fieldErrorTexts(
  error: unknown,
  t: Messages,
  overrides: FieldErrorOverrides = {},
): Record<string, string> {
  const result: Record<string, string> = {}
  if (!(error instanceof ApiError) || !Array.isArray(error.problem?.errors)) return result

  for (const e of error.problem.errors) {
    if (typeof e?.field !== 'string' || Object.hasOwn(result, e.field)) continue
    const code = typeof e.code === 'string' ? e.code : ''
    result[e.field] = overrides[e.field]?.[code] ?? genericFieldText(code, t)
  }
  return result
}

function genericFieldText(code: string, t: Messages): string {
  switch (code) {
    case 'required':
      return t.errors.field.required
    case 'too_long':
    case 'too_large':
    case 'too_many_items':
      return t.errors.field.tooLong
    case 'too_short':
    case 'too_small':
    case 'too_few_items':
      return t.errors.field.tooShort
    case 'invalid_format':
      return t.errors.field.invalidFormat
    default:
      return t.errors.field.invalid
  }
}
