import { describe, expect, it } from 'vitest'

import { ru as t } from '../i18n/ru'
import { apiErrorText, fieldErrorTexts, tooManyRequestsText } from './errorText'
import { ApiError, NetworkError, UNKNOWN_ERROR_CODE } from './http'

const apiError = (status: number, code: string) => new ApiError({ status, code })

// Число и слово formatCount соединяет неразрывным пробелом — в ожиданиях пишем обычный.
const plain = (text: string) => text.replace(/ /g, ' ')

describe('tooManyRequestsText', () => {
  it.each([
    [1, 'Слишком много попыток. Попробуйте через 1 минуту.'],
    [59, 'Слишком много попыток. Попробуйте через 1 минуту.'],
    [60, 'Слишком много попыток. Попробуйте через 1 минуту.'],
    [61, 'Слишком много попыток. Попробуйте через 2 минуты.'],
    [4 * 60, 'Слишком много попыток. Попробуйте через 4 минуты.'],
    [5 * 60, 'Слишком много попыток. Попробуйте через 5 минут.'],
    [15 * 60, 'Слишком много попыток. Попробуйте через 15 минут.'],
    [21 * 60, 'Слишком много попыток. Попробуйте через 21 минуту.'],
    [22 * 60 - 30, 'Слишком много попыток. Попробуйте через 22 минуты.'],
    [60 * 60, 'Слишком много попыток. Попробуйте через 60 минут.'],
  ])('%i с → «%s»', (seconds, expected) => {
    expect(plain(tooManyRequestsText(seconds, t))).toBe(expected)
  })

  it('0 секунд — всё равно «через 1 минуту», а не «через 0»', () => {
    expect(plain(tooManyRequestsText(0, t))).toBe(
      'Слишком много попыток. Попробуйте через 1 минуту.',
    )
  })

  it('число и слово не разрываются переносом строки', () => {
    expect(tooManyRequestsText(120, t)).toContain('2 минуты')
  })

  it('без Retry-After — «немного позже»', () => {
    expect(tooManyRequestsText(undefined, t)).toBe(t.errors.tooManyRequestsLater)
  })
})

describe('apiErrorText', () => {
  it.each([
    ['сеть', new NetworkError(), t.errors.network],
    ['invalid_credentials', apiError(401, 'invalid_credentials'), t.errors.invalidCredentials],
    ['unauthorized', apiError(401, 'unauthorized'), t.errors.sessionExpired],
    ['forbidden_origin', apiError(403, 'forbidden_origin'), t.errors.forbiddenOrigin],
    ['validation_failed', apiError(422, 'validation_failed'), t.errors.validation],
    ['not_found', apiError(404, 'not_found'), t.errors.notFound],
    ['internal', apiError(500, 'internal'), t.errors.server],
    // Неизвестный код — по статусу.
    ['неизвестный код, 502', apiError(502, UNKNOWN_ERROR_CODE), t.errors.server],
    ['неизвестный код, 401', apiError(401, 'session_revoked'), t.errors.sessionExpired],
    ['неизвестный код, 404', apiError(404, 'gone'), t.errors.notFound],
    ['неизвестный код, 422', apiError(422, 'new_rule'), t.errors.validation],
    ['неизвестный код, 409', apiError(409, 'conflict'), t.errors.generic],
    ['bad_request', apiError(400, 'bad_request'), t.errors.generic],
    ['не ошибка API', new Error('boom'), t.errors.generic],
  ])('%s', (_, error, expected) => {
    expect(apiErrorText(error, t)).toBe(expected)
  })

  it('too_many_requests — с минутами из Retry-After', () => {
    const error = new ApiError({ status: 429, code: 'too_many_requests', retryAfterSeconds: 300 })
    expect(plain(apiErrorText(error, t))).toBe('Слишком много попыток. Попробуйте через 5 минут.')
  })

  it('429 с неизвестным кодом (от прокси) — тоже про лимит', () => {
    const error = new ApiError({ status: 429, code: UNKNOWN_ERROR_CODE, retryAfterSeconds: 90 })
    expect(plain(apiErrorText(error, t))).toBe('Слишком много попыток. Попробуйте через 2 минуты.')
  })

  it('detail сервера не показывается', () => {
    const error = new ApiError({ status: 500, code: 'internal', detail: 'pq: deadlock detected' })
    expect(apiErrorText(error, t)).not.toContain('deadlock')
  })
})

describe('fieldErrorTexts', () => {
  const validation = (errors: { field: string; code: string; message: string }[]) =>
    new ApiError({
      status: 422,
      code: 'validation_failed',
      problem: { status: 422, code: 'validation_failed', errors },
    })

  it('текст по коду нарушения, а не сообщение сервера', () => {
    const error = validation([
      { field: 'name', code: 'required', message: 'Обязательное поле.' },
      { field: 'password', code: 'too_short', message: 'server text' },
      { field: 'email', code: 'invalid_format', message: 'server text' },
      { field: 'timezone', code: 'something_new', message: 'server text' },
    ])
    expect(fieldErrorTexts(error, t)).toEqual({
      name: t.errors.field.required,
      password: t.errors.field.tooShort,
      email: t.errors.field.invalidFormat,
      timezone: t.errors.field.invalid,
    })
  })

  it('тексты для поля и кода из overrides важнее общих', () => {
    const error = validation([
      { field: 'email', code: 'email_taken', message: 'x' },
      { field: 'password', code: 'too_short', message: 'x' },
    ])
    expect(
      fieldErrorTexts(error, t, {
        email: { email_taken: t.auth.validation.emailTaken },
        password: { too_long: t.auth.validation.passwordTooLong },
      }),
    ).toEqual({
      email: t.auth.validation.emailTaken,
      password: t.errors.field.tooShort,
    })
  })

  it('у поля — первое нарушение', () => {
    const error = validation([
      { field: 'email', code: 'required', message: 'x' },
      { field: 'email', code: 'too_long', message: 'x' },
    ])
    expect(fieldErrorTexts(error, t)).toEqual({ email: t.errors.field.required })
  })

  it('не 422 и не ошибка API — пусто', () => {
    expect(fieldErrorTexts(new NetworkError(), t)).toEqual({})
    expect(fieldErrorTexts(apiError(401, 'invalid_credentials'), t)).toEqual({})
    expect(fieldErrorTexts(undefined, t)).toEqual({})
  })
})
