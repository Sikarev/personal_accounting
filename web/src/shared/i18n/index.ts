import { createContext, useContext } from 'react'

import { ru, type Messages } from './ru'

export type { Messages }

/** Локаль для Intl-форматтеров. Интерфейс пока только на русском (requirements, раздел 7). */
export const LOCALE = 'ru-RU'

/**
 * Словарь текущего языка для кода вне React (форматтеры, тосты).
 * В компонентах используйте `useT()`.
 */
export const messages: Messages = ru

const I18nContext = createContext<Messages>(messages)

/** Провайдер понадобится, когда появится второй язык; до тех пор работает значение по умолчанию. */
export const I18nProvider = I18nContext.Provider

/**
 * Доступ к строкам интерфейса: `const t = useT()` → `t.nav.home`.
 * Ключи проверяются типами: опечатка в пути — ошибка компиляции.
 */
export function useT(): Messages {
  return useContext(I18nContext)
}
