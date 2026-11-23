// Атрибуты элементов, на которые экран «Операции» переводит фокус, когда элемент с фокусом
// исчезает (удалена строка, снят фильтр). Иначе фокус уходит на `body`.

/** Кнопка меню строки операции: значение — id операции. */
export const ROW_MENU = 'data-transaction-menu'

export const rowMenuSelector = (id: string) => `[${ROW_MENU}="${id}"]`

/** Поле поиска — запасная цель, если соседних строк или чипов не осталось. */
export const SEARCH_FIELD = 'data-feed-search'
