import { useEffect, useState } from 'react'

/** Порог из ux.md, раздел 4: если ответ быстрее, индикатор загрузки не показываем вовсе. */
export const LOADING_DELAY_MS = 300

/**
 * Возвращает `true`, только если загрузка длится дольше `delayMs`.
 * Так быстрый ответ не вызывает мигания скелетона.
 *
 * ```tsx
 * const showSkeleton = useDelayedLoading(query.isPending)
 * if (query.isPending) return showSkeleton ? <TransactionListSkeleton /> : null
 * ```
 */
export function useDelayedLoading(isLoading: boolean, delayMs = LOADING_DELAY_MS): boolean {
  const [isDelayPassed, setDelayPassed] = useState(false)

  useEffect(() => {
    if (!isLoading) return
    const timer = setTimeout(() => setDelayPassed(true), delayMs)
    // Очистка срабатывает и при окончании загрузки: следующая начнётся с нуля.
    return () => {
      clearTimeout(timer)
      setDelayPassed(false)
    }
  }, [isLoading, delayMs])

  return isLoading && isDelayPassed
}
