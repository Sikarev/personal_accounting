import '@fontsource-variable/inter'
import '@mantine/core/styles.layer.css'
import '@mantine/notifications/styles.layer.css'

import type { Preview } from '@storybook/react-vite'

import { ThemeProviders } from '../src/app/AppProviders'

type ColorScheme = 'light' | 'dark'

const preview: Preview = {
  // Переключатель темы в панели инструментов Storybook.
  globalTypes: {
    theme: {
      description: 'Цветовая тема',
      toolbar: {
        title: 'Тема',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Светлая', icon: 'sun' },
          { value: 'dark', title: 'Тёмная', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
  },
  decorators: [
    (Story, context) => (
      <ThemeProviders forceColorScheme={context.globals.theme as ColorScheme}>
        <Story />
      </ThemeProviders>
    ),
  ],
  parameters: {
    layout: 'padded',
    a11y: {
      // Нарушения axe отображаются как ошибки, а не как предупреждения.
      test: 'error',
    },
  },
}

export default preview
