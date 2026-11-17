import { defineConfig, devices } from '@playwright/test'

// UI-тесты оболочки (ux.md, раздел 9): две ширины × две темы.
//
// Тесты размечены тегами:
// - @visual — скриншотные; эталоны зависят от ОС и шрифтового рендеринга, поэтому
//   в репозитории лежат эталоны win32 и в CI (Linux) эти тесты не запускаются;
// - @a11y — проверка axe; от ОС не зависят и запускаются в CI (`pnpm test:a11y`).
//
// Тестируется production-сборка (`vite preview`): так проверяем то, что увидит
// пользователь, а dev-бейдж статуса API не попадает в кадр.

// Не 4173 (порт vite preview по умолчанию), чтобы не подхватить чужой запущенный preview.
const PORT = 4180

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  expect: {
    toHaveScreenshot: {
      // Строгое сравнение: на одной машине рендеринг детерминирован, а допуск даже в 1 %
      // (≈10 тыс. пикселей на 1280×800) пропускал обрезанную подпись кнопки.
      maxDiffPixels: 0,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    // Mantine отключает анимации при reduced motion — кадр не ловит середину перехода.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-light',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        isMobile: true,
        colorScheme: 'light',
      },
    },
    {
      name: 'mobile-dark',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        isMobile: true,
        colorScheme: 'dark',
      },
    },
    {
      name: 'desktop-light',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        colorScheme: 'light',
      },
    },
    {
      name: 'desktop-dark',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        colorScheme: 'dark',
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite build && pnpm exec vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
