import type { CurrencyTotal, Transaction, TransactionList } from '../api'

// Лента операций на клиенте: страницы `GET /transactions` → группы по дням с итогом дня.

export type DayGroup = {
  /** Дата `YYYY-MM-DD`. */
  date: string
  items: Transaction[]
  /** Итог дня от сервера: по валютам, расходы и доходы; пусто — итога нет. */
  totals: CurrencyTotal[]
}

/**
 * Итоги дней со всех загруженных страниц: дата → итоги по валютам.
 *
 * Сервер считает итог дня по **всем** операциям этой даты под теми же фильтрами, даже
 * если день разрезан границей страницы, — поэтому дата, попавшая на две страницы, приходит
 * в обеих с одинаковым итогом. Если страницы загружены в разное время и итоги разошлись,
 * берётся итог более поздней страницы: она загружена позже.
 */
export function mergeDays(
  pages: readonly Pick<TransactionList, 'days'>[],
): Map<string, CurrencyTotal[]> {
  const result = new Map<string, CurrencyTotal[]>()
  for (const page of pages) {
    for (const day of page.days) result.set(day.date, day.totals)
  }
  return result
}

/**
 * Операции → группы по дням. Порядок сохраняется (сервер отдаёт по дате ↓): соседние
 * операции одной даты — одна группа. Итога дня нет в `days` — группа без итога.
 */
export function groupByDay(
  items: readonly Transaction[],
  days: ReadonlyMap<string, CurrencyTotal[]>,
): DayGroup[] {
  const groups: DayGroup[] = []
  for (const item of items) {
    const last = groups.at(-1)
    if (last && last.date === item.date) {
      last.items.push(item)
    } else {
      groups.push({ date: item.date, items: [item], totals: days.get(item.date) ?? [] })
    }
  }
  return groups
}

/** Одна сумма итога: расход — со знаком «−», доход — «+». */
export type TotalAmount = { currency: string; amount: number }

/**
 * Суммы для показа итога (заголовок дня): по каждой валюте расход (отрицательный)
 * и доход (положительный), нули пропускаются.
 */
export function totalAmounts(totals: readonly CurrencyTotal[]): TotalAmount[] {
  const result: TotalAmount[] = []
  for (const total of totals) {
    if (total.expense !== 0) result.push({ currency: total.currency, amount: -total.expense })
    if (total.income !== 0) result.push({ currency: total.currency, amount: total.income })
  }
  return result
}

/** Порядок ленты: дата ↓, затем id ↓ (uuidv7 растёт со временем создания). */
export function compareFeedOrder(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  if (a.id !== b.id) return a.id < b.id ? 1 : -1
  return 0
}
