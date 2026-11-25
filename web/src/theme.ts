import { createTheme, rem, type CSSVariablesResolver } from '@mantine/core'

// Дизайн-токены приложения (docs/ux.md, раздел 2). Значения «на месте» в компонентах
// запрещены: только токены отсюда или CSS-переменные, которые они порождают.
//
// Контраст семантических цветов проверен по WCAG 2.2 AA (≥ 4.5:1 для текста) на фонах
// body и приглушённой поверхности в обеих темах. Меняешь цвет — перепроверь контраст
// (Playwright + axe в e2e/a11y это ловит, но только на тех экранах, где цвет виден).

const fontFamily =
  "'Inter Variable', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

/** Размеры каркаса приложения. Используются в AppShell и CSS-модулях (через переменные). */
export const layout = {
  /** Ширина бокового меню на desktop. */
  navbarWidth: 248,
  /** Высота нижней панели на mobile без учёта safe-area. */
  bottomNavHeight: 64,
  /** Максимальная ширина контента: на широком экране строки не растягиваются на всю ширину. */
  contentMaxWidth: 1040,
  /** Минимальная зона касания (ux.md, раздел 6). */
  touchTarget: 44,
  /** Ширина формы входа и регистрации на desktop (на mobile — во всю ширину). */
  authFormWidth: 420,
  /** Ширина текстовой страницы (документы): длина строки удобна для чтения. */
  readingWidth: 680,
  /**
   * Диаметр кольцевой диаграммы в отчётах. Переменная — в пикселях, не в rem: recharts
   * рисует кольцо в пикселях, и при крупном шрифте рамка не должна расти отдельно от него.
   */
  chartSize: 208,
} as const

/**
 * Иконки Tabler: один набор, единая толщина линий и несколько размеров по контексту
 * (ux.md: «один размер и толщина линий в пределах контекста»).
 *
 * Размеры — в rem, а не в пикселях: при увеличенном системном шрифте иконки растут
 * вместе с подписями (ux.md, раздел 6). Толщину линий задаём только этим токеном.
 */
export const icons = {
  stroke: 1.75,
  size: {
    /** Внутри кнопок и пунктов меню (20 px при стандартном шрифте). */
    md: rem(20),
    /** Нижняя панель, крупные кнопки (24 px). */
    lg: rem(24),
    /** Иллюстрация пустого состояния (28 px). */
    xl: rem(28),
  },
  /** Подложка иконки пустого состояния (56 px). */
  badgeSize: rem(56),
} as const

export const theme = createTheme({
  primaryColor: 'indigo',
  // indigo-7 на белом — 4.98:1, белый текст на indigo-8 в тёмной теме — 5.67:1.
  primaryShade: { light: 7, dark: 8 },
  // Чистый #000 на белом слишком резкий; gray-9 мягче и даёт 15:1.
  black: '#212529',
  fontFamily,
  fontFamilyMonospace: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',

  // Пять размеров шрифта на всё приложение (ux.md: «4–5 размеров, не больше»):
  // xs — подписи и мелкие пометки, sm — вторичный текст, md — основной,
  // lg — заголовки разделов, xl — заголовок экрана и главная цифра.
  fontSizes: {
    xs: rem(12),
    sm: rem(14),
    md: rem(16),
    lg: rem(20),
    xl: rem(28),
  },
  lineHeights: {
    xs: '1.4',
    sm: '1.45',
    md: '1.5',
    lg: '1.35',
    xl: '1.25',
  },
  headings: {
    fontFamily,
    fontWeight: '600',
    textWrap: 'balance',
    // Заголовки переиспользуют ту же шкалу размеров, новых не вводим.
    sizes: {
      h1: { fontSize: rem(28), lineHeight: '1.25' },
      h2: { fontSize: rem(20), lineHeight: '1.35' },
      h3: { fontSize: rem(16), lineHeight: '1.5' },
      h4: { fontSize: rem(16), lineHeight: '1.5' },
      h5: { fontSize: rem(14), lineHeight: '1.45' },
      h6: { fontSize: rem(14), lineHeight: '1.45' },
    },
  },

  // Шкала отступов: xs 4 · sm 8 · md 16 · lg 24 · xl 32. Других значений нет.
  spacing: {
    xs: rem(4),
    sm: rem(8),
    md: rem(16),
    lg: rem(24),
    xl: rem(32),
  },
  radius: {
    xs: rem(4),
    sm: rem(6),
    md: rem(8),
    lg: rem(12),
    xl: rem(16),
  },
  defaultRadius: 'md',

  // Mantine отключает свои анимации при prefers-reduced-motion (ux.md, раздел 6).
  respectReducedMotion: true,
  cursorType: 'pointer',
  focusRing: 'auto',

  components: {
    Modal: {
      defaultProps: { transitionProps: { duration: 200 } },
    },
    Drawer: {
      defaultProps: { transitionProps: { duration: 200 } },
    },
    Notifications: {
      defaultProps: { transitionDuration: 200 },
    },
  },
})

/**
 * Семантические цвета. В компонентах пишем `c={semanticColors.income}`,
 * а не конкретный оттенок: значение само переключается между темами.
 */
export const semanticColors = {
  /** Доход, положительное движение денег. */
  income: 'var(--app-color-income)',
  /** Проблема: отрицательный остаток, ошибка. Не для обычных расходов. */
  negative: 'var(--app-color-negative)',
  /** Акцентный текст (активный пункт меню и т. п.) с достаточным контрастом в обеих темах. */
  accentText: 'var(--app-color-accent-text)',
} as const

/**
 * Палитра графиков (сегменты кольца в отчётах и метки строк таблицы под ним): восемь цветов
 * категорий и приглушённый для «Прочего». Значения — `--app-chart-*` ниже, свои в каждой
 * теме: в тёмной — светлее, чтобы сегменты не тонули в фоне. Соседние цвета разнесены
 * по тону; цвет — не единственный носитель смысла: рядом всегда название и сумма.
 */
export const chartColors = {
  series: Array.from({ length: 8 }, (_, i) => `var(--app-chart-${i + 1})`),
  other: 'var(--app-chart-other)',
} as const

// Оттенки палитры графиков по темам: [цвет, оттенок светлой, оттенок тёмной]. Каждый —
// не меньше 3:1 к фону карточки (WCAG 1.4.11): к белому 3,7–6,1, к dark-7 5,2–9,0.
// Жёлтого нет: даже yellow-9 к белому — 3,0:1. Соседние сегменты различаются тоном
// (тёплый ↔ холодный), а не только яркостью. «Прочее»: gray-6 — 3,3:1, dark-2 — 4,0:1.
// Пересчёт — скриптом по палитре Mantine (default-colors), формула WCAG.
const chartPalette = [
  ['indigo', 6, 4],
  ['orange', 9, 5],
  ['teal', 9, 5],
  ['pink', 7, 4],
  ['blue', 9, 4],
  ['lime', 9, 5],
  ['grape', 7, 4],
  ['cyan', 9, 5],
] as const

const chartVariables = (scheme: 'light' | 'dark') =>
  Object.fromEntries(
    chartPalette.map(([color, light, dark], i) => [
      `--app-chart-${i + 1}`,
      `var(--mantine-color-${color}-${scheme === 'light' ? light : dark})`,
    ]),
  )

/**
 * Дополняет CSS-переменные Mantine: семантические цвета и размеры каркаса.
 * Заодно усиливает `dimmed` и `error`: стандартные оттенки Mantine не проходят AA
 * (gray-6 на белом — 3.3:1, dark-2 на dark-7 — 4.0:1).
 */
export const cssVariablesResolver: CSSVariablesResolver = (t) => ({
  variables: {
    '--app-navbar-width': rem(layout.navbarWidth),
    '--app-bottom-nav-height': rem(layout.bottomNavHeight),
    '--app-content-max-width': rem(layout.contentMaxWidth),
    '--app-touch-target': rem(layout.touchTarget),
    '--app-auth-form-width': rem(layout.authFormWidth),
    '--app-reading-width': rem(layout.readingWidth),
    '--app-chart-size': `${layout.chartSize}px`,
  },
  light: {
    '--mantine-color-dimmed': '#656c73', // 5.4:1 на белом, 5.1:1 на gray-0
    '--mantine-color-error': 'var(--mantine-color-red-9)', // 5.5:1
    '--app-color-income': '#2b7a3b', // 5.3:1 на белом; green-9 из палитры даёт только 4.4:1
    '--app-color-negative': 'var(--mantine-color-red-9)',
    // Shade 9: 5.3:1 даже на светлой подложке активного пункта меню (shade 7 там — 3.9:1).
    '--app-color-accent-text': `var(--mantine-color-${t.primaryColor}-9)`,
    '--app-color-surface': 'var(--mantine-color-gray-0)',
    // Кольцо фокуса (WCAG 1.4.11, ≥ 3:1): 4.98 на белом, 4.73 на gray-0,
    // 3.93 на подложке активного пункта меню (indigo-1).
    '--app-focus-ring': `var(--mantine-color-${t.primaryColor}-7)`,
    // Наведение на кнопку variant="light": у Mantine фон indigo-2, и текст indigo-9 на нём —
    // 4.1:1, ниже AA. Середина между indigo-1 и indigo-2 даёт 4.7:1 и остаётся заметной.
    [`--mantine-color-${t.primaryColor}-light-hover`]: `color-mix(in srgb, var(--mantine-color-${t.primaryColor}-1), var(--mantine-color-${t.primaryColor}-2))`,
    '--mantine-primary-color-light-hover': `var(--mantine-color-${t.primaryColor}-light-hover)`,
    ...chartVariables('light'),
    '--app-chart-other': 'var(--mantine-color-gray-6)',
  },
  dark: {
    '--mantine-color-dimmed': '#a3a3a3', // 6.5:1 на dark-7, 5.4:1 на dark-6
    '--mantine-color-error': 'var(--mantine-color-red-4)', // 6.7:1
    '--app-color-income': 'var(--mantine-color-green-5)', // 7.7:1
    '--app-color-negative': 'var(--mantine-color-red-4)',
    '--app-color-accent-text': `var(--mantine-color-${t.primaryColor}-3)`,
    '--app-color-surface': 'var(--mantine-color-dark-8)',
    // Стандартное кольцо Mantine в тёмной теме — indigo-8, всего 2.74:1 на dark-7.
    // indigo-4: 5.23 на dark-7, 5.55 на dark-8, 4.58 на dark-6, 3.78 на dark-5 (hover),
    // 4.61 на подложке активного пункта меню.
    '--app-focus-ring': `var(--mantine-color-${t.primaryColor}-4)`,
    ...chartVariables('dark'),
    '--app-chart-other': 'var(--mantine-color-dark-2)',
  },
})
