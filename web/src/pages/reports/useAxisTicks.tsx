import { useMemo } from 'react'

import { useT } from '../../shared/i18n'
import { AxisTickLabel, type TickProps } from './AxisTickLabel'
import { axisTicks } from './trendReport'

/** Ширина оси сумм, px: «−1,25 млн ₽» шрифтом 12 px. */
const Y_AXIS_WIDTH = 76
/** Высота оси дат, px: подпись и под ней год. */
const X_AXIS_HEIGHT = 40

// Сколько места по горизонтали нужно одной подписи (шрифт 12 px, с промежутком): «ноя» —
// около 22 px, «24 ноя» — около 38 px.
const TICK_SPACING = { month: 40, day: 56 }
/** Поле справа, px: половина самой широкой подписи «24 ноя». */
const CHART_RIGHT_MARGIN = 24
/** Пока ширина блока не измерена (первый кадр) — подписей не больше этого. */
const FALLBACK_TICKS = 6

/**
 * Подписи оси дат графика трендов: какие показать — по ширине блока (`axisTicks`),
 * а не по измерению текста в recharts. `width` — ширина блока графика (`useElementSize`):
 * она от загрузки шрифта не зависит, поэтому набор подписей стабилен (и в скриншотах).
 */
export function useAxisTicks(values: readonly string[], kind: 'month' | 'day', width: number) {
  const t = useT()
  const maxTicks =
    width > 0
      ? Math.floor((width - Y_AXIS_WIDTH - CHART_RIGHT_MARGIN) / TICK_SPACING[kind])
      : FALLBACK_TICKS
  const ticks = useMemo(() => axisTicks(values, kind, maxTicks, t), [values, kind, maxTicks, t])
  const byValue = useMemo(() => new Map(ticks.map((tick) => [tick.value, tick])), [ticks])
  return {
    /** Пропсы оси X recharts: явные деления, без собственного прореживания. */
    xAxisProps: {
      height: X_AXIS_HEIGHT,
      ticks: ticks.map((tick) => tick.value),
      interval: 0 as const,
      tick: (props: TickProps) => <AxisTickLabel {...props} ticks={byValue} />,
    },
    /** Пропсы оси сумм: своя ширина под компактные подписи. */
    yAxisProps: { width: Y_AXIS_WIDTH },
    /**
     * Поля графика: справа — половина подписи («24 ноя» по центру последней точки
     * иначе обрезалась бы краем).
     */
    margin: { top: 5, right: CHART_RIGHT_MARGIN, bottom: 0, left: 0 },
  }
}
