import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

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

/**
 * Ответ «нет действующей сессии»: cookie нет, сессия истекла или завершена.
 * 401 `invalid_credentials` (неверный пароль при входе) сюда не относится — это ошибка формы.
 */
export function isUnauthorizedError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401 && error.code !== 'invalid_credentials'
}

export type QueryClientOptions = {
  /**
   * Вызывается при 401 на любом запросе или изменении (см. `isUnauthorizedError`):
   * приложение сбрасывает кэш и ведёт на экран входа.
   */
  onUnauthorized?: (error: ApiError) => void
}

/** Пока данные свежие, повторный монтаж экрана не делает запрос. */
export const DEFAULT_STALE_TIME = 30_000

/**
 * QueryClient с умолчаниями приложения. Функция, а не готовый экземпляр:
 * у каждого места использования (приложение, тест, история Storybook) свой кэш.
 */
export function createQueryClient({ onUnauthorized }: QueryClientOptions = {}): QueryClient {
  // Обработчик на уровне кэша, а не в каждом хуке: истёкшая сессия обнаруживается
  // любым запросом, и реакция на неё везде одна.
  const handleError = (error: unknown) => {
    if (onUnauthorized && isUnauthorizedError(error)) onUnauthorized(error)
  }
  return new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
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
