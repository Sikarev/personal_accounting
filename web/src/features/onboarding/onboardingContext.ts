import { createContext, useContext } from 'react'

export type OnboardingApi = {
  /**
   * Показана карточка «где вносить операции» (шаг 2). Состояние только в памяти:
   * после перезагрузки шаг 2 не нужен — счёт уже есть, а кнопку «+» видно и так.
   */
  introVisible: boolean
  /** Первый счёт создан — показать шаг 2. */
  showIntro: () => void
  /** «Понятно» — скрыть шаг 2. */
  hideIntro: () => void
}

export const OnboardingContext = createContext<OnboardingApi | null>(null)

/**
 * Состояние онбординга для главной (что показать) и оболочки (выделить кнопку
 * быстрого ввода, пока видна карточка шага 2).
 */
export function useOnboarding(): OnboardingApi {
  const api = useContext(OnboardingContext)
  if (!api) throw new Error('useOnboarding: компонент должен быть внутри <OnboardingProvider>')
  return api
}
