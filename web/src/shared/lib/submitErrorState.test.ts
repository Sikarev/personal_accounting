import { describe, expect, it } from 'vitest'

import { ApiError, NetworkError } from '../api'
import { ru as t } from '../i18n/ru'
import { submitErrorState } from './submitErrorState'

const validation = (errors: { field: string; code: string }[]) =>
  new ApiError({
    status: 422,
    code: 'validation_failed',
    problem: { errors: errors.map((e) => ({ ...e, message: 'текст сервера' })) },
  })

describe('submitErrorState', () => {
  it('ошибки только у полей формы — к полям, без сообщения над формой', () => {
    const error = validation([{ field: 'email', code: 'required' }])
    expect(submitErrorState(error, t, ['email', 'password'])).toEqual({
      fieldErrors: { email: t.errors.field.required },
      formError: null,
      retryable: false,
    })
  })

  it('нарушение у поля, которого в форме нет, — ещё и сообщение над формой', () => {
    const error = validation([
      { field: 'email', code: 'required' },
      { field: 'timezone', code: 'invalid' },
    ])
    const state = submitErrorState(error, t, ['email'])
    expect(state.fieldErrors).toEqual({ email: t.errors.field.required })
    expect(state.formError).toBe(t.errors.validation)
  })

  it('текст поля берётся из переопределений по коду нарушения', () => {
    const error = validation([{ field: 'balance', code: 'too_large' }])
    const state = submitErrorState(error, t, ['balance'], {
      balance: { too_large: 'Слишком большая сумма' },
    })
    expect(state.fieldErrors).toEqual({ balance: 'Слишком большая сумма' })
  })

  it('ошибка не про поля — только сообщение над формой', () => {
    const error = new ApiError({ status: 401, code: 'invalid_credentials' })
    expect(submitErrorState(error, t, ['email'])).toEqual({
      fieldErrors: {},
      formError: t.errors.invalidCredentials,
      retryable: false,
    })
  })

  it('ошибка сети — сообщение с «Повторить»', () => {
    expect(submitErrorState(new NetworkError(), t, ['email'])).toEqual({
      fieldErrors: {},
      formError: t.errors.network,
      retryable: true,
    })
  })
})
