import { QueryClient } from '@tanstack/react-query'

import { ApiError, NetworkError } from './http'

/**
 * Повторять ли запрос. 4xx — ошибка запроса или прав: повтор даст тот же ответ.
 * Сеть и 5xx бывают временными — один повтор.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false
  if (error instanceof NetworkError) return true
  return error instanceof ApiError && error.status >= 500
}

/** Пока данные свежие, повторный монтаж экрана не делает запрос. */
export const DEFAULT_STALE_TIME = 30_000

/**
 * QueryClient с умолчаниями приложения. Функция, а не готовый экземпляр:
 * у каждого места использования (приложение, тест, история Storybook) свой кэш.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: DEFAULT_STALE_TIME,
        // refetchOnWindowFocus остаётся по умолчанию (true): вернулся во вкладку —
        // увидел изменения, сделанные с другого устройства.
      },
      mutations: {
        // Изменения не повторяются автоматически: повтор POST после 5xx может создать дубль.
        retry: false,
      },
    },
  })
}
