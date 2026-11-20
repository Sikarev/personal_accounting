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

// Порт можно переопределить (E2E_PORT=4181 pnpm test:e2e), чтобы параллельные worktree
// не мешали друг другу. По умолчанию не 4173 — порт vite preview из коробки.
const PORT = Number(process.env.E2E_PORT ?? 4180)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  expect: {
    toHaveScreenshot: {
      // Сравнение двумя порогами:
      // - maxDiffPixels: 0 — ни одного отличающегося пикселя: допуск даже в 1 %
      //   (≈10 тыс. пикселей на 1280×800) пропускал обрезанную подпись кнопки;
      // - threshold — насколько должен отличаться цвет, чтобы пиксель вообще считался
      //   отличающимся (0–1, в пространстве YIQ). У Playwright по умолчанию 0.2 — при нём
      //   не замечались смена фона на соседний оттенок, тень и состояние наведения, и
      //   устаревшие эталоны проходили. 0.005 — самое строгое из проверенных значений,
      //   при котором полный набор трижды подряд проходит без ложных падений
      //   (при 0 падают 3 скриншота из-за сглаживания). Начнутся ложные падения на
      //   другой машине — поднимать до 0.01–0.02, а не возвращать 0.2.
      // E2E_THRESHOLD — только для подбора порога, в обычной работе не задаётся.
      threshold: Number(process.env.E2E_THRESHOLD ?? 0.005),
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
    // Всегда своя свежая сборка: занятый порт — ошибка, а не тихое тестирование
    // чужого сервера (например, preview из соседнего worktree).
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
