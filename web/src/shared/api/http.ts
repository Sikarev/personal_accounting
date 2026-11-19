/**
 * fetch-мутатор для клиента, сгенерированного orval (orval.config.ts).
 * Через него идут все запросы к API: здесь cookie сессии и разбор ошибок.
 *
 * Ответ 2xx — разобранное тело. Ответ не 2xx — исключение `ApiError`,
 * сеть недоступна — `NetworkError`. Отмена запроса (TanStack Query отменяет
 * устаревшие запросы через `signal`) пробрасывается как есть.
 */

/** Ошибка поля из `errors[]` ответа 422 `validation_failed` (docs/api.md → «Ошибки»). */
export interface FieldErrorBody {
  field: string
  code: string
  message: string
}

/**
 * Тело `application/problem+json` (RFC 9457). Поля — как у схемы `Problem` в контракте,
 * но все необязательные: мутатор не доверяет телу ошибки (его мог сформировать и прокси).
 * Своя копия, а не сгенерированный тип, — чтобы мутатор не зависел от результата генерации.
 */
export interface ProblemBody {
  type?: string
  title?: string
  status?: number
  detail?: string
  code?: string
  errors?: FieldErrorBody[]
}

/** `code`, если сервер не прислал Problem Details (502 от прокси, HTML вместо JSON и т. п.). */
export const UNKNOWN_ERROR_CODE = 'unknown'

/** `code`, если ответ 2xx, но тело не JSON: клиент и сервер разошлись. */
export const INVALID_RESPONSE_CODE = 'invalid_response'

/**
 * Сервер ответил, но не 2xx. Текст для пользователя выбирается по `code`;
 * неизвестный код — по `status` (список кодов в контракте может расширяться).
 */
export class ApiError extends Error {
  override readonly name = 'ApiError'
  readonly status: number
  /** Машиночитаемый код: `validation_failed`, `not_found`, … или `UNKNOWN_ERROR_CODE`. */
  readonly code: string
  /** Пояснение сервера для разработчика. Пользователю не показывается. */
  readonly detail: string | undefined
  /**
   * Ошибки полей: путь через точку (`amount`, `splits.0.amount`) → текст.
   * Формат путей совпадает с `@mantine/form`: `form.setErrors(error.fieldErrors)`.
   */
  readonly fieldErrors: Record<string, string>
  /** `X-Request-Id` ответа — по нему ошибку находят в логах сервера. */
  readonly requestId: string | undefined
  /** Исходное тело, если это был Problem Details. */
  readonly problem: ProblemBody | undefined

  constructor(init: {
    status: number
    code: string
    detail?: string
    fieldErrors?: Record<string, string>
    requestId?: string
    problem?: ProblemBody
  }) {
    super(init.detail ?? `HTTP ${init.status} (${init.code})`)
    this.status = init.status
    this.code = init.code
    this.detail = init.detail
    this.fieldErrors = init.fieldErrors ?? {}
    this.requestId = init.requestId
    this.problem = init.problem
  }
}

/** Ответа нет: сеть недоступна, сервер не отвечает, запрос заблокирован. */
export class NetworkError extends Error {
  override readonly name = 'NetworkError'

  constructor(options?: { cause?: unknown }) {
    super('Сетевая ошибка: сервер не ответил', options)
  }
}

/**
 * Тип ошибки в сгенерированных хуках: orval подставляет его вместо `unknown`,
 * если мутатор экспортирует `ErrorType`.
 */
export type ErrorType<_Error> = ApiError | NetworkError

/** Мутатор orval: `apiFetch<CurrencyList>('/api/v1/currencies', { method: 'GET', signal })`. */
export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      // Запросы идут на тот же origin (в dev — через прокси Vite), cookie сессии
      // отправляются браузером сами; на чужие адреса — нет.
      credentials: 'same-origin',
      headers: withAccept(init.headers),
    })
  } catch (err) {
    // Отмену не превращаем в ошибку сети: TanStack Query отличает её по имени AbortError.
    if (init.signal?.aborted) throw err
    throw new NetworkError({ cause: err })
  }

  const requestId = res.headers.get('X-Request-Id') ?? undefined
  const text = await readText(res, init.signal)

  if (!res.ok) throw toApiError(res, text, requestId)

  // 204 и пустое тело — у операций без ответа (удаление и т. п.).
  if (text === '') return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError({ status: res.status, code: INVALID_RESPONSE_CODE, requestId })
  }
}

function withAccept(headers: HeadersInit | undefined): Headers {
  const h = new Headers(headers)
  if (!h.has('Accept')) h.set('Accept', 'application/json, application/problem+json')
  return h
}

/** Тело читается текстом: так пустой ответ и не-JSON обрабатываются одинаково для всех статусов. */
async function readText(res: Response, signal: AbortSignal | null | undefined): Promise<string> {
  try {
    return await res.text()
  } catch (err) {
    if (signal?.aborted) throw err
    // Соединение оборвалось посреди тела.
    throw new NetworkError({ cause: err })
  }
}

function toApiError(res: Response, text: string, requestId: string | undefined): ApiError {
  const problem = parseProblem(res, text)
  if (!problem) return new ApiError({ status: res.status, code: UNKNOWN_ERROR_CODE, requestId })

  return new ApiError({
    status: res.status,
    code: problem.code || UNKNOWN_ERROR_CODE,
    detail: problem.detail,
    fieldErrors: toFieldErrors(problem.errors),
    requestId,
    problem,
  })
}

function parseProblem(res: Response, text: string): ProblemBody | undefined {
  const type = res.headers.get('Content-Type') ?? ''
  if (!/^application\/(problem\+)?json\b/i.test(type) || text === '') return undefined
  try {
    const body: unknown = JSON.parse(text)
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as ProblemBody)
      : undefined
  } catch {
    return undefined
  }
}

function toFieldErrors(errors: unknown): Record<string, string> {
  const result: Record<string, string> = {}
  if (!Array.isArray(errors)) return result
  for (const e of errors as Partial<FieldErrorBody>[]) {
    // Если у поля несколько нарушений, показываем первое: у поля формы одна строка ошибки.
    if (
      typeof e?.field === 'string' &&
      typeof e.message === 'string' &&
      !Object.hasOwn(result, e.field)
    ) {
      result[e.field] = e.message
    }
  }
  return result
}
