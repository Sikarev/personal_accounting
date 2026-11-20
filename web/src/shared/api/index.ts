// Клиент API: сгенерированные хуки и типы (generated/, не править руками — `pnpm generate:api`),
// ошибки мутатора и QueryClient с умолчаниями приложения.
export * from './generated/api'
export * from './generated/model'
export {
  ApiError,
  NetworkError,
  UNKNOWN_ERROR_CODE,
  INVALID_RESPONSE_CODE,
  parseRetryAfter,
} from './http'
export type { ProblemBody, FieldErrorBody } from './http'
export {
  createQueryClient,
  shouldRetry,
  isUnauthorizedError,
  DEFAULT_STALE_TIME,
} from './queryClient'
export type { QueryClientOptions } from './queryClient'
export { apiErrorText, fieldErrorTexts, tooManyRequestsText } from './errorText'
export type { FieldErrorOverrides } from './errorText'
