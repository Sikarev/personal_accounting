/**
 * Куда вернуть пользователя после входа: параметр `next` из адреса экрана входа.
 *
 * `next` приходит из адресной строки, его может подставить кто угодно, поэтому
 * принимается только относительный путь внутри приложения. Иначе ссылка
 * `/login?next=//evil.com` после входа увела бы на чужой сайт (open redirect):
 * роутер, получив адрес другого origin, делает обычный переход браузера.
 *
 * Отклоняются:
 * - всё, что не начинается с одного `/` (`https://…`, `javascript:…`, `evil.com`);
 * - `//host` и `/\host` — браузер понимает их как адрес другого сайта
 *   (обратную косую черту он превращает в прямую);
 * - пробельные и управляющие символы: браузер вырезает табуляцию и переводы строк,
 *   и `/\t/evil.com` превратился бы в `//evil.com`;
 * - обратная косая черта в любом месте — в пути приложения ей делать нечего.
 *
 * Последней стоит проверка через `URL`: путь, разобранный относительно своего origin,
 * должен остаться на нём же.
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw) return fallback
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback
  // eslint-disable-next-line no-control-regex -- управляющие символы и ищем
  if (/[\s\\\u0000-\u001f\u007f]/.test(raw)) return fallback

  const base = 'https://app.invalid'
  try {
    if (new URL(raw, base).origin !== base) return fallback
  } catch {
    return fallback
  }
  return raw
}
