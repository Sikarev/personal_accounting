/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Куда dev-сервер проксирует /api. По умолчанию — API на :8080; в соседнем worktree
// можно запустить API на другом порту: API_PROXY_TARGET=http://localhost:8091 pnpm dev.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Бюджет проекта — 250 КБ gzip на первую загрузку (ux.md §8), его проверяем отдельно.
    // Ленивый чанк «Отчётов» с графиками (recharts) больше 500 КБ до сжатия осознанно:
    // он грузится только на этом экране, делить его искусственно незачем.
    chunkSizeWarningLimit: 600,
  },
  server: {
    // В разработке фронт и API на одном origin: cookie сессии работают без CORS.
    // changeOrigin: false — заголовок Host остаётся адресом dev-сервера. Короткая запись
    // ('/api': target) подменяет Host на адрес API, и защита от CSRF в API
    // (http.CrossOriginProtection) отклоняла запросы с телефона по адресу в локальной
    // сети: там браузер не шлёт Sec-Fetch-Site (только для localhost и HTTPS), и API
    // сравнивает Origin с Host — а они расходились.
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/healthz': { target: apiTarget, changeOrigin: false },
    },
  },
  test: {
    // Юнит-тесты — чистые функции (форматтеры) и хуки через renderToString, DOM не нужен.
    // Компоненты проверяются в Storybook и Playwright (e2e/).
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
