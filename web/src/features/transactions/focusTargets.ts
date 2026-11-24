// Атрибуты элементов списка операций, на которые экран переводит фокус, когда элемент
// с фокусом исчезает (удалена строка, закрыта форма правки). Иначе фокус уходит на `body`.

/** Кнопка меню строки операции: значение — id операции. */
export const ROW_MENU = 'data-transaction-menu'

/** Кнопка самой строки (открыть операцию) — `ROW_BUTTON` в TransactionRow. */
export const rowButtonSelector = (id: string) => `[data-transaction-open="${id}"]`
