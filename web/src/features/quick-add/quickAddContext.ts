import { createContext, useContext } from 'react'

import type { Transaction } from '../../shared/api'

export type QuickAddOpenOptions = {
  /**
   * Куда вернуть фокус после закрытия окна — вместо элемента, с которого открыли
   * (он мог исчезнуть: пункт меню, форма правки на месте строки).
   */
  returnFocus?: () => void
}

export type QuickAddApi = {
  /**
   * Открыть быстрый ввод операции поверх текущего экрана. `template` — создать по образцу
   * (дублирование из ленты): значения образца, дата — «сегодня».
   */
  open: (template?: Transaction, options?: QuickAddOpenOptions) => void
}

export const QuickAddContext = createContext<QuickAddApi | null>(null)

/** Открывает быстрый ввод из любого места: кнопки «+», пустых состояний, горячих клавиш. */
export function useQuickAdd(): QuickAddApi {
  const api = useContext(QuickAddContext)
  if (!api) throw new Error('useQuickAdd: компонент должен быть внутри <QuickAddProvider>')
  return api
}
