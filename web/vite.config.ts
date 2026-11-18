/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // В разработке фронт и API на одном origin: cookie сессии работают без CORS.
    proxy: {
      '/api': 'http://localhost:8080',
      '/healthz': 'http://localhost:8080',
    },
  },
  test: {
    // Юнит-тесты — чистые функции (форматтеры), DOM не нужен.
    // Компоненты проверяются в Storybook и Playwright (e2e/).
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
