import { useState } from 'react'

import type { ReportFilters } from './reportFilters'

// Общее для запросов вкладок отчётов: защита от «старые данные под новыми фильтрами»
// и выбор запросов, из-за которых показывать нечего.

type ReportQuery = {
  data?: unknown
  isPlaceholderData: boolean
}

/**
 * Пока грузится отчёт с новыми фильтрами, на экране — прежний (`placeholderData`). Рисовать
 * его нужно с теми фильтрами, по которым он получен: иначе заголовок врал бы («в октябре»
 * при суммах за ноябрь), а ссылки вели бы с новыми фильтрами по старым строкам.
 * Запоминаем фильтры последнего настоящего ответа; `key` — параметры запроса.
 */
export function useShownFilters(
  report: ReportQuery,
  key: string,
  filters: ReportFilters,
): { stale: boolean; shownFilters: ReportFilters } {
  const [loaded, setLoaded] = useState<{ key: string; filters: ReportFilters } | null>(null)
  if (report.data && !report.isPlaceholderData && loaded?.key !== key) {
    setLoaded({ key, filters })
  }
  const stale = report.isPlaceholderData
  return { stale, shownFilters: stale && loaded ? loaded.filters : filters }
}

export type FailingQuery = {
  data?: unknown
  isPlaceholderData: boolean
  isError: boolean
  errorUpdateCount: number
  error: unknown
  isFetching: boolean
  refetch: () => Promise<unknown>
}

/**
 * Запросы, из-за которых показывать нечего. Ошибка — только когда данных нет: при фоновой
 * ошибке остаются прежние данные. Отчёт с новыми фильтрами не загрузился — прежний
 * (placeholder) на экране не оставляем: он выдавал бы себя за отчёт по новым фильтрам.
 * Счётчик ошибок держит блок ошибки на месте во время «Повторить» (как на главной).
 */
export function failedQueries(queries: readonly FailingQuery[]): FailingQuery[] {
  return queries.filter(
    (q) => (!q.data || q.isPlaceholderData) && (q.isError || q.errorUpdateCount > 0),
  )
}
