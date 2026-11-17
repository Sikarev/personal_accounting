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
 * `today` передаётся явно в тестах и там, где «сегодня» считается в часовом поясе
 * пользователя из профиля; по умолчанию — локальная дата браузера.
 */
export function formatOpDate(
  date: CalendarDateInput,
  today: CalendarDateInput = new Date(),
): string {
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
