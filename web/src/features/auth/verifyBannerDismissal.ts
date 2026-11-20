/**
 * Плашку «Подтвердите e-mail» можно скрыть до следующего входа. Отметка — в sessionStorage:
 * живёт, пока открыта вкладка, и стирается при входе и выходе.
 *
 * Хранилище может быть недоступно (приватный режим, запрет cookie и данных сайтов) —
 * тогда плашка просто скрывается до перезагрузки страницы, без ошибок.
 */
const KEY = 'pa.verifyBannerDismissed'

/** Скрыта ли плашка для этого пользователя. */
export function isVerifyBannerDismissed(userId: string): boolean {
  try {
    return sessionStorage.getItem(KEY) === userId
  } catch {
    return false
  }
}

export function dismissVerifyBanner(userId: string): void {
  try {
    sessionStorage.setItem(KEY, userId)
  } catch {
    // Не сохранилось — плашка вернётся после перезагрузки; не повод для ошибки.
  }
}

export function resetVerifyBannerDismissal(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // См. выше.
  }
}
