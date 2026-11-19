import { defineConfig } from 'orval'

// Клиент API генерируется из контракта: `pnpm generate:api`. Результат коммитится,
// CI проверяет, что он совпадает с контрактом (docs/api.md → «Инструменты генерации»).
export default defineConfig({
  api: {
    input: '../api/openapi.yaml',
    output: {
      target: 'src/shared/api/generated/api.ts',
      // Типы схем — отдельными файлами в model/, операции и хуки — в api.ts.
      schemas: 'src/shared/api/generated/model',
      mode: 'split',
      client: 'react-query',
      httpClient: 'fetch',
      // В контракте пути без префикса, базовый адрес задан в servers (см. docs/api.md).
      baseUrl: '/api/v1',
      // Каталог очищается перед генерацией: эндпоинт, удалённый из контракта, не оставит файлов.
      clean: true,
      formatter: 'prettier',
      override: {
        // Все запросы — через свой fetch: cookie сессии, разбор ошибок в ApiError.
        mutator: { path: 'src/shared/api/http.ts', name: 'apiFetch' },
        fetch: {
          // Хуки возвращают само тело ответа, а не обёртку { data, status, headers }:
          // не-2xx мутатор бросает как ApiError, статус успешного ответа не нужен.
          includeHttpResponseReturnType: false,
        },
      },
    },
  },
})
