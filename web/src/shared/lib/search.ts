import { LOCALE } from '../i18n'

/**
 * Приводит строку к виду для поиска (ux.md, «Быстрый ввод»: без учёта регистра и «ё/е»):
 * нижний регистр, «ё» → «е», пробелы по краям убраны, подряд идущие пробелы — один.
 *
 * Применяется и к запросу, и к тексту, в котором ищем: сравниваются нормализованные строки.
 */
export function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase(LOCALE).replaceAll('ё', 'е').replace(/\s+/g, ' ').trim()
}

/**
 * Содержит ли текст запрос (подстрока после нормализации). Пустой запрос подходит ко всему —
 * пока пользователь ничего не ввёл, список не фильтруется.
 */
export function matchesSearch(text: string, query: string): boolean {
  const q = normalizeSearch(query)
  return q === '' || normalizeSearch(text).includes(q)
}
