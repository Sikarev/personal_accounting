// Шрифт Inter — из локального пакета, а не с Google Fonts (ux.md, раздел 2: 152-ФЗ).
// Браузер скачает только нужные подмножества (кириллица, латиница) по unicode-range.
import '@fontsource-variable/inter'
// Слойные версии стилей Mantine (@layer mantine): наши CSS-модули перекрывают их
// без гонки специфичности и без !important.
import '@mantine/core/styles.layer.css'
import '@mantine/notifications/styles.layer.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import { App } from './app/App'
import { AppProviders } from './app/AppProviders'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProviders>
        <App />
      </AppProviders>
    </BrowserRouter>
  </StrictMode>,
)
