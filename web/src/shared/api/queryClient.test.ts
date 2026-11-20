import { describe, expect, it, vi } from 'vitest'

import { ApiError, NetworkError } from './http'
import { createQueryClient, isUnauthorizedError } from './queryClient'

const unauthorized = new ApiError({ status: 401, code: 'unauthorized' })
const invalidCredentials = new ApiError({ status: 401, code: 'invalid_credentials' })

describe('isUnauthorizedError', () => {
  it.each([
    ['401 unauthorized', unauthorized, true],
    ['401 с неизвестным кодом', new ApiError({ status: 401, code: 'unknown' }), true],
    ['401 invalid_credentials — ошибка формы входа', invalidCredentials, false],
    ['403', new ApiError({ status: 403, code: 'forbidden_origin' }), false],
    ['сеть', new NetworkError(), false],
    ['не ошибка API', new Error('x'), false],
  ])('%s → %s', (_, error, expected) => {
    expect(isUnauthorizedError(error)).toBe(expected)
  })
})

describe('createQueryClient: onUnauthorized', () => {
  it('вызывается при 401 запроса', async () => {
    const onUnauthorized = vi.fn()
    const client = createQueryClient({ onUnauthorized })
    await client
      .fetchQuery({ queryKey: ['me'], queryFn: () => Promise.reject(unauthorized) })
      .catch(() => {})
    expect(onUnauthorized).toHaveBeenCalledWith(unauthorized)
  })

  it('вызывается при 401 изменения, но не при неверном пароле', async () => {
    const onUnauthorized = vi.fn()
    const client = createQueryClient({ onUnauthorized })
    const run = (error: Error) =>
      client
        .getMutationCache()
        .build(client, { mutationFn: () => Promise.reject(error) })
        .execute(undefined)
        .catch(() => {})

    await run(invalidCredentials)
    expect(onUnauthorized).not.toHaveBeenCalled()

    await run(unauthorized)
    expect(onUnauthorized).toHaveBeenCalledWith(unauthorized)
  })

  it('другие ошибки не считаются выходом из сессии', async () => {
    const onUnauthorized = vi.fn()
    const client = createQueryClient({ onUnauthorized })
    await client
      .fetchQuery({
        queryKey: ['x'],
        queryFn: () => Promise.reject(new ApiError({ status: 404, code: 'not_found' })),
      })
      .catch(() => {})
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
