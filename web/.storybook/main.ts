import type { StorybookConfig } from '@storybook/react-vite'

// Витрина базовых компонентов (ux.md, раздел 9: «каждый показан в изоляции во всех состояниях»).
// Сборка Vite берётся из vite.config.ts проекта, PostCSS-настройки Mantine — из postcss.config.cjs.
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  // a11y — панель axe прямо в Storybook: контраст и подписи видны во время разработки.
  addons: ['@storybook/addon-a11y'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  core: {
    disableTelemetry: true,
  },
}

export default config
