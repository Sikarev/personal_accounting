import { LOCALE, messages } from '../i18n'

/**
 * Календарная дата: строка `YYYY-MM-DD` (так даты операций приходят из API — без времени)
 * или `Date` (берутся её локальные год, месяц и день).
 */
export type CalendarDateInput = string | Date

type CalendarDate = { year: number; month: number; day: number }

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function toCalendarDate(input: CalendarDateInput): CalendarDate {
  if (input instanceof Date) {
    return { year: input.getFullYear(), month: input.getMonth() + 1, day: input.getDate() }
  }
  const match = ISO_DATE.exec(input)
  if (!match) throw new RangeError(`Ожидается дата в формате YYYY-MM-DD, получено «${input}»`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

// Все вычисления — в UTC: так переход на летнее время и часовой пояс браузера
// не сдвигают дату на день.
function toUtc({ year, month, day }: CalendarDate): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

const DAY_MS = 24 * 60 * 60 * 1000

const todayFormats = new Map<string, Intl.DateTimeFormat>()

/**
 * «Сегодня» в часовом поясе пользователя — строка `YYYY-MM-DD`.
 *
 * Пояс берётся из профиля пользователя (появится на этапе 1), а не из часов браузера:
 * в поездке или на чужом компьютере «сегодня» не должно съезжать. До этапа 1 вызывающий
 * код передаёт пояс явно.
 *
 * `now` — момент времени (по умолчанию текущий), параметр нужен для тестов.
 */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  let format = todayFormats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    todayFormats.set(timeZone, format)
  }
  // Собираем из частей, а не из строки: порядок полей зависит от локали.
  const parts = Object.fromEntries(format.formatToParts(now).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

const weekdayFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'long',
})

const fullDateFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase(LOCALE) + value.slice(1)
}

/**
 * Дата операции для ленты (ux.md, раздел 2):
 * «Сегодня», «Вчера», «Пн, 16 ноября» в текущем году, «16 ноября 2025» для других лет.
 *
 * `today` обязателен: «сегодня» считается в часовом поясе пользователя из профиля
 * (`todayIn(user.timeZone)`), а не по часам браузера. Так же он делает функцию
 * детерминированной в тестах.
 */
export function formatOpDate(date: CalendarDateInput, today: CalendarDateInput): string {
  const target = toCalendarDate(date)
  const now = toCalendarDate(today)
  const diffDays = Math.round((toUtc(now).getTime() - toUtc(target).getTime()) / DAY_MS)

  if (diffDays === 0) return messages.dates.today
  if (diffDays === 1) return messages.dates.yesterday

  if (target.year === now.year) {
    // Intl даёт «пн, 16 ноября» — в заголовке группы нужна заглавная буква.
    return capitalize(weekdayFormat.format(toUtc(target)))
  }

  // Собираем из частей, чтобы не тащить «г.» из «16 ноября 2025 г.».
  return fullDateFormat
    .formatToParts(toUtc(target))
    .filter((part) => part.type === 'day' || part.type === 'month' || part.type === 'year')
    .map((part) => part.value)
    .join(' ')
}
