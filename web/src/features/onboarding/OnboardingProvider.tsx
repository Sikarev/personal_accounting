import { useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'

import { paths } from '../../app/navigation'
import { OnboardingContext, type OnboardingApi } from './onboardingContext'

/**
 * Держит состояние онбординга. Стоит в оболочке (`AppLayout`), а не на главной: карточку
 * шага 2 показывает главная, а выделение кнопки «+» / «Добавить операцию» рисует оболочка.
 *
 * Ушёл с главной — шаг 2 больше не показываем: иначе выделенная кнопка висела бы на всех
 * экранах, пока пользователь не вернётся на главную нажать «Понятно».
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [introVisible, setIntroVisible] = useState(false)
  const { pathname } = useLocation()

  // Поправка состояния прямо в рендере (а не в эффекте) — рекомендуемый React способ
  // сбросить состояние при смене входных данных: без лишнего кадра со старым значением.
  if (introVisible && pathname !== paths.home) setIntroVisible(false)

  const api = useMemo<OnboardingApi>(
    () => ({
      introVisible,
      showIntro: () => setIntroVisible(true),
      hideIntro: () => setIntroVisible(false),
    }),
    [introVisible],
  )

  return <OnboardingContext.Provider value={api}>{children}</OnboardingContext.Provider>
}
