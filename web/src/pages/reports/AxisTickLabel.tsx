import type { AxisTick } from './trendReport'

export type TickProps = {
  x?: number | string
  y?: number | string
  payload?: { value: string }
}

/** Подпись деления: «ноя» или «24 ноя», под ней год — там, где он нужен. */
export function AxisTickLabel({
  x,
  y,
  payload,
  ticks,
}: TickProps & { ticks: Map<string, AxisTick> }) {
  const tick = payload && ticks.get(payload.value)
  if (!tick) return null
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={12} fill="currentColor">
      <tspan x={x} dy="1em">
        {tick.label}
      </tspan>
      {tick.year && (
        <tspan x={x} dy="1.2em">
          {tick.year}
        </tspan>
      )}
    </text>
  )
}
