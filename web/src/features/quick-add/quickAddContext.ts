import { createContext, useContext } from 'react'

import type { Transaction } from '../../shared/api'

export type QuickAddApi = {
  /**
   * Открыть быстрый ввод операции поверх текущего экрана. `template` — создать по образцу
   * (дублирование из ленты): значения образца, дата — «сегодня».
   */
  open: (template?: Transaction) => void
}

export const QuickAddContext = createContext<QuickAddApi | null>(null)

/** Открывает быстрый ввод из любого места: кнопки «+», пустых состояний, горячих клавиш. */
export function useQuickAdd(): QuickAddApi {
  const api = useContext(QuickAddContext)
  if (!api) throw new Error('useQuickAdd: компонент должен быть внутри <QuickAddProvider>')
  return api
}
