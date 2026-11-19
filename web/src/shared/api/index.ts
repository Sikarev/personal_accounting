// Клиент API: сгенерированные хуки и типы (generated/, не править руками — `pnpm generate:api`),
// ошибки мутатора и QueryClient с умолчаниями приложения.
export * from './generated/api'
export * from './generated/model'
export { ApiError, NetworkError, UNKNOWN_ERROR_CODE, INVALID_RESPONSE_CODE } from './http'
export type { ProblemBody, FieldErrorBody } from './http'
export { createQueryClient, shouldRetry, DEFAULT_STALE_TIME } from './queryClient'
