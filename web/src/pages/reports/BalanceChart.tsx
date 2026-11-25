// Стили графиков — только здесь, в ленивом чанке отчётов: в первую загрузку не попадают.
import '@mantine/charts/styles.layer.css'

import { LineChart } from '@mantine/charts'

import type { BalancePoint, BalanceStep } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { formatMoneyCompact } from '../../shared/lib/moneyCompact'
import { Money } from '../../shared/ui'
import { chartColors, layout } from '../../theme'
import { ChartReadout } from './ChartReadout'
import type { ReportFilters } from './reportFilters'
import { crossesZero, dayTick, monthTick, pointLabel } from './trendReport'
import { useChartSelection } from './useChartSelection'
import classes from './ReportsPage.module.css'

/** Ширина оси сумм, px: «−1,25 млн ₽» шрифтом 12 px. */
const Y_AXIS_WIDTH = 76
/** Высота оси дат, px: у месяцев под названием — год. */
const X_AXIS_HEIGHT = 40
/** Точки-маркеры рисуются, пока их немного: на 121 месяце они слились бы в толстую линию. */
const MAX_DOTS = 31

/**
 * Динамика общего баланса (requirements 5.10): линия остатка по точкам, шаг выбирает
 * сервер (день, неделя, месяц). Ось значений — по данным, а не от нуля: у линии (в отличие
 * от столбцов) ноль не обязателен, а с ним изменение в несколько процентов от остатка
 * было бы не разглядеть. Если остаток переходит через ноль — линия нуля.
 *
 * Перехода в ленту нет: у точки баланса нет «своих» операций. Мышь — наведение показывает
 * остаток под графиком, палец — касание. График скрыт от диктора, эквивалент — таблица.
 */
export function BalanceChart({
  items,
  step,
  currency,
  filters,
  today,
}: {
  items: BalancePoint[]
  step: BalanceStep
  currency: string
  filters: ReportFilters
  today: string
}) {
  const t = useT()
  const selection = useChartSelection()
  const values = items.map((point) => point.balance)
  const shown = items[selection.active ?? items.length - 1]

  return (
    <div className={classes.trendChart} aria-hidden {...selection.wrapperProps}>
      <LineChart
        h={layout.trendChartHeight}
        data={items}
        dataKey="date"
        series={[{ name: 'balance', label: t.reports.balance.series, color: chartColors.line }]}
        curveType="linear"
        withDots={items.length <= MAX_DOTS}
        valueFormatter={(value) => formatMoneyCompact(value, currency)}
        tooltipProps={{ content: () => null }}
        accessibilityLayer={false}
        xAxisProps={{
          height: X_AXIS_HEIGHT,
          tick: (props: TickProps) => <DateTick {...props} step={step} />,
          // По этой строке recharts меряет подписи и решает, какие пропустить.
          tickFormatter: (value: string) =>
            step === 'month' ? monthTick(value, 1, t).label : dayTick(value, t),
        }}
        yAxisProps={{ width: Y_AXIS_WIDTH, domain: ['auto', 'auto'] }}
        referenceLines={crossesZero(values) ? [{ y: 0, color: chartColors.zero }] : undefined}
        lineChartProps={selection.chartHandlers}
      />
      {shown && (
        <ChartReadout
          title={pointLabel(shown.date, step, filters, today, t)}
          items={[
            {
              key: 'balance',
              label: t.reports.balance.series,
              marker: 'line',
              color: chartColors.line,
              value: (
                <Money amount={shown.balance} currency={currency} roundToMajor variant="balance" />
              ),
            },
          ]}
        />
      )}
    </div>
  )
}

type TickProps = {
  x?: number | string
  y?: number | string
  payload?: { value: string; index: number }
}

/** Подпись оси: день и неделя — «24 ноя» (точка недели — её последний день), месяц — «ноя». */
function DateTick({ x, y, payload, step }: TickProps & { step: BalanceStep }) {
  const t = useT()
  if (!payload) return null
  const { label, year } =
    step === 'month'
      ? monthTick(payload.value, payload.index, t)
      : { label: dayTick(payload.value, t), year: null }
  return (
    <text x={x} y={y} textAnchor="middle" fontSize={12} fill="currentColor">
      <tspan x={x} dy="1em">
        {label}
      </tspan>
      {year && (
        <tspan x={x} dy="1.2em">
          {year}
        </tspan>
      )}
    </text>
  )
}
