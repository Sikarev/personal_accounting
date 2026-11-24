// Куда главная переводит фокус: форма на странице (desktop), главное действие пустого
// блока операций, «Все операции» — запасные цели, когда элемент с фокусом исчез.

/** Блок формы быстрого ввода на странице (desktop). */
export const HOME_FORM = 'data-home-form'

/** Главное действие пустого блока операций: «Добавить операцию» / «Ввести операцию». */
export const HOME_PRIMARY_ACTION = 'data-home-primary-action'

/** Ссылка «Все операции». */
export const RECENT_ALL_LINK = 'data-recent-all'

/** Сколько кадров ждать цель фокуса (~1 с): ленивый чанк формы или блока ещё грузится. */
const WAIT_FRAMES = 60

/**
 * Поставить фокус на элемент `selector`, как только он появится: после «Понятно» или
 * по кнопке главная ещё дорисовывает ленивые блоки (форму, последние операции).
 * Не дождались — `fallback`, если он есть.
 */
export function focusWhenPresent(selector: string, fallback?: () => HTMLElement | null) {
  let frames = 0
  const attempt = () => {
    const el = document.querySelector<HTMLElement>(selector)
    if (el) return el.focus()
    if (++frames < WAIT_FRAMES) return void requestAnimationFrame(attempt)
    fallback?.()?.focus()
  }
  requestAnimationFrame(attempt)
}

/**
 * Фокус в сумму формы на странице (desktop): кнопки «Ввести операцию» и «Внести первую
 * операцию», «Понятно» в онбординге. Форма ещё грузится — ждём её; не дождались — фокус
 * на блок формы, диктор прочитает заголовок.
 */
export function focusHomeForm() {
  focusWhenPresent(`[${HOME_FORM}] input[inputmode="decimal"]`, () =>
    document.querySelector<HTMLElement>(`[${HOME_FORM}]`),
  )
}
