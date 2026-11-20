/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Куда dev-сервер проксирует /api. По умолчанию — API на :8080; в соседнем worktree
// можно запустить API на другом порту: API_PROXY_TARGET=http://localhost:8091 pnpm dev.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // В разработке фронт и API на одном origin: cookie сессии работают без CORS.
    proxy: {
      '/api': apiTarget,
      '/healthz': apiTarget,
    },
  },
  test: {
    // Юнит-тесты — чистые функции (форматтеры) и хуки через renderToString, DOM не нужен.
    // Компоненты проверяются в Storybook и Playwright (e2e/).
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
