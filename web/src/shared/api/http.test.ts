import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiFetch, INVALID_RESPONSE_CODE, NetworkError, UNKNOWN_ERROR_CODE } from './http'
import { shouldRetry } from './queryClient'

const fetchMock = vi.fn<typeof fetch>()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => {
  fetchMock.mockReset()
})

function problem(status: number, body: object, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/problem+json', ...headers },
  })
}

/** Ошибка, которую бросил apiFetch. Если не бросил — тест падает. */
async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    return err
  }
  throw new Error('ожидалась ошибка')
}

describe('apiFetch', () => {
  it('200: возвращает тело и отправляет cookie только на свой origin', async () => {
    const body = { items: [{ code: 'RUB', name: 'Российский рубль', symbol: '₽', minorUnits: 2 }] }
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(apiFetch('/api/v1/currencies', { method: 'GET' })).resolves.toEqual(body)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/currencies')
    expect(init?.method).toBe('GET')
    expect(init?.credentials).toBe('same-origin')
    expect(new Headers(init?.headers).get('Accept')).toContain('application/json')
  })

  it('204: пустое тело — undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(apiFetch('/api/v1/x', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('422 validation_failed: ошибки полей и request id', async () => {
    fetchMock.mockResolvedValue(
      problem(
        422,
        {
          type: 'about:blank',
          title: 'Unprocessable Entity',
          status: 422,
          detail: 'Некорректные данные запроса.',
          code: 'validation_failed',
          errors: [
            { field: 'amount', code: 'required', message: 'Обязательное поле.' },
            { field: 'splits.0.amount', code: 'too_small', message: 'Сумма должна быть больше 0.' },
            // Второе нарушение того же поля не затирает первое.
            { field: 'amount', code: 'invalid_type', message: 'Ожидается число.' },
          ],
        },
        { 'X-Request-Id': 'req-422' },
      ),
    )

    const err = await caught(apiFetch('/api/v1/transactions', { method: 'POST' }))

    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      status: 422,
      code: 'validation_failed',
      detail: 'Некорректные данные запроса.',
      requestId: 'req-422',
      fieldErrors: {
        amount: 'Обязательное поле.',
        'splits.0.amount': 'Сумма должна быть больше 0.',
      },
    })
  })

  it('404 not_found: код и пустые ошибки полей', async () => {
    fetchMock.mockResolvedValue(
      problem(404, {
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: 'Счёт не найден.',
        code: 'not_found',
      }),
    )

    const err = await caught(apiFetch('/api/v1/accounts/1', { method: 'GET' }))

    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 404, code: 'not_found', fieldErrors: {} })
    expect((err as ApiError).requestId).toBeUndefined()
  })

  it('код не из контракта передаётся как есть', async () => {
    fetchMock.mockResolvedValue(
      problem(401, {
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        code: 'unauthorized',
      }),
    )
    const err = await caught(apiFetch('/api/v1/me', { method: 'GET' }))
    expect(err).toMatchObject({ status: 401, code: 'unauthorized', detail: undefined })
  })

  it('500 без тела: ApiError с неизвестным кодом', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 500, headers: { 'X-Request-Id': 'r5' } }),
    )

    const err = await caught(apiFetch('/api/v1/currencies', { method: 'GET' }))

    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      status: 500,
      code: UNKNOWN_ERROR_CODE,
      requestId: 'r5',
      fieldErrors: {},
      problem: undefined,
    })
  })

  it('не-JSON ответ с ошибкой (HTML от прокси): ApiError по статусу', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    const err = await caught(apiFetch('/api/v1/currencies', { method: 'GET' }))
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 502, code: UNKNOWN_ERROR_CODE })
  })

  it('битый JSON с заголовком problem+json: ApiError по статусу', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"code":', {
        status: 400,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    )
    const err = await caught(apiFetch('/api/v1/currencies', { method: 'GET' }))
    expect(err).toMatchObject({ status: 400, code: UNKNOWN_ERROR_CODE })
  })

  it('200 с не-JSON телом: ApiError invalid_response', async () => {
    fetchMock.mockResolvedValue(
      new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    const err = await caught(apiFetch('/api/v1/currencies', { method: 'GET' }))
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 200, code: INVALID_RESPONSE_CODE })
  })

  it('сетевая ошибка: NetworkError с исходной причиной', async () => {
    const cause = new TypeError('Failed to fetch')
    fetchMock.mockRejectedValue(cause)

    const err = await caught(apiFetch('/api/v1/currencies', { method: 'GET' }))

    expect(err).toBeInstanceOf(NetworkError)
    expect(err).not.toBeInstanceOf(ApiError)
    expect((err as NetworkError).cause).toBe(cause)
  })

  it('отмена запроса пробрасывается как есть, не как сетевая ошибка', async () => {
    const controller = new AbortController()
    controller.abort()
    const abortError = new DOMException('aborted', 'AbortError')
    fetchMock.mockRejectedValue(abortError)

    const err = await caught(apiFetch('/api/v1/currencies', { signal: controller.signal }))

    expect(err).toBe(abortError)
  })
})

describe('shouldRetry', () => {
  const apiError = (status: number) => new ApiError({ status, code: UNKNOWN_ERROR_CODE })

  it.each([
    ['сеть', new NetworkError(), true],
    ['500', apiError(500), true],
    ['503', apiError(503), true],
    ['400', apiError(400), false],
    ['401', apiError(401), false],
    ['404', apiError(404), false],
    ['422', apiError(422), false],
    ['200 invalid_response', apiError(200), false],
    ['прочая ошибка', new Error('x'), false],
  ])('%s: первый повтор — %s', (_, error, expected) => {
    expect(shouldRetry(0, error)).toBe(expected)
  })

  it('не больше одного повтора', () => {
    expect(shouldRetry(1, new NetworkError())).toBe(false)
    expect(shouldRetry(1, apiError(500))).toBe(false)
  })
})
