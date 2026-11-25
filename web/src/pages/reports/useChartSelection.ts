import { useRef, useState, type PointerEvent } from 'react'

/** Что recharts передаёт в обработчики графика (нужен только индекс точки). */
type ChartState = { activeTooltipIndex?: number | string | null }

function indexOf(state: ChartState): number | null {
  const index = Number(state.activeTooltipIndex)
  return state.activeTooltipIndex == null || Number.isNaN(index) ? null : index
}

/**
 * Выбранная точка графика трендов и чем на неё указали.
 *
 * Мышь: наведение выбирает точку, уход с графика — сбрасывает. Палец: касание выбирает
 * точку и она остаётся выбранной (наведения у пальца нет). Тип указателя запоминается
 * по `pointerdown`: он приходит раньше `click` и раньше эмулированных после касания
 * событий мыши — иначе `mousemove` после касания выбрал бы точку до `click`, и первое же
 * касание столбца уводило бы в ленту.
 *
 * `data` — данные графика: пришли другие (сменился период или счета) — выбор сброшен.
 * Иначе индекс указывал бы на другую точку или за конец ряда, а «второе касание» по
 * новому графику сразу уводило бы в ленту.
 */
export function useChartSelection(data: unknown) {
  const pointer = useRef('mouse')
  const [active, setActive] = useState<number | null>(null)
  const [touched, setTouched] = useState(false)
  const [lastData, setLastData] = useState(data)
  if (data !== lastData) {
    setLastData(data)
    setActive(null)
    setTouched(false)
  }

  return {
    /** Индекс выбранной точки; `null` — не выбрана. */
    active,
    /** Точку выбрали касанием: можно подсказать «коснитесь ещё раз». */
    touched,
    byMouse: () => pointer.current === 'mouse',
    /** Выбрать точку касанием или кликом (без перехода). */
    select: (index: number) => {
      setActive(index)
      setTouched(pointer.current !== 'mouse')
    },
    /** Обработчики обёртки графика. */
    wrapperProps: {
      onPointerDown: (e: PointerEvent) => {
        pointer.current = e.pointerType
      },
      onMouseLeave: () => {
        if (pointer.current === 'mouse') setActive(null)
      },
    },
    /** Обработчики самого графика (`onMouseMove`, `onClick` у recharts). */
    chartHandlers: {
      onMouseMove: (state: ChartState) => {
        if (pointer.current === 'mouse') setActive(indexOf(state))
      },
      onClick: (state: ChartState) => {
        const index = indexOf(state)
        if (index === null) return
        setActive(index)
        setTouched(pointer.current !== 'mouse')
      },
    },
  }
}
