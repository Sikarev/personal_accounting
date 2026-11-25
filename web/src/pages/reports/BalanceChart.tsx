// Стили графиков — только здесь, в ленивом чанке отчётов: в первую загрузку не попадают.
import '@mantine/charts/styles.layer.css'

import { LineChart } from '@mantine/charts'
import { useElementSize } from '@mantine/hooks'
import { useMemo } from 'react'

import type { BalancePoint, BalanceStep } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { formatMoneyCompact } from '../../shared/lib/moneyCompact'
import { Money } from '../../shared/ui'
import { chartColors, layout } from '../../theme'
import { ChartReadout } from './ChartReadout'
import type { ReportFilters } from './reportFilters'
import { useAxisTicks } from './useAxisTicks'
import { crossesZero, pointLabel } from './trendReport'
import { useChartSelection } from './useChartSelection'
import classes from './ReportsPage.module.css'

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
  const selection = useChartSelection(items)
  const dates = useMemo(() => items.map((point) => point.date), [items])
  const { ref, width } = useElementSize()
  const axis = useAxisTicks(dates, step === 'month' ? 'month' : 'day', width)
  const values = items.map((point) => point.balance)
  const shown = items[selection.active ?? items.length - 1]

  return (
    <div className={classes.trendChart} aria-hidden ref={ref} {...selection.wrapperProps}>
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
        xAxisProps={axis.xAxisProps}
        yAxisProps={{ ...axis.yAxisProps, domain: ['auto', 'auto'] }}
        referenceLines={crossesZero(values) ? [{ y: 0, color: chartColors.zero }] : undefined}
        lineChartProps={{ ...selection.chartHandlers, margin: axis.margin }}
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
