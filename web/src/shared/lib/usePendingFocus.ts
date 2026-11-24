import { useCallback, useEffect, useRef } from 'react'

type Pending = { ready: () => boolean; targets: string[] }

/**
 * Перевести фокус, когда изменение уже на экране. Элемент с фокусом может исчезнуть
 * (удалённая строка, закрытая форма) — фокус ставим после перерисовки, иначе он ушёл бы
 * вместе с элементом на `body`. Ждать «пару кадров» нельзя: кэш TanStack Query оповещает
 * компоненты через `setTimeout`, и под нагрузкой кадры успевали раньше перерисовки.
 *
 * Возвращает `focusWhenReady(ready, targets)`: после каждой перерисовки компонента
 * проверяется `ready()` («изменение отрисовано»), и фокус уходит на первый найденный
 * селектор из `targets`. Данные, которые читает `ready`, обновляйте в эффекте, объявленном
 * до вызова этого хука: эффекты выполняются в порядке объявления.
 */
export function usePendingFocus(): (ready: () => boolean, targets: string[]) => void {
  const pending = useRef<Pending | null>(null)
  useEffect(() => {
    const current = pending.current
    if (!current || !current.ready()) return
    pending.current = null
    // Два кадра — запас на закрытие меню Mantine, которое тоже двигает фокус.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const selector of current.targets) {
          const el = document.querySelector<HTMLElement>(selector)
          if (el) return el.focus()
        }
      }),
    )
  })
  return useCallback((ready, targets) => {
    pending.current = { ready, targets }
  }, [])
}
