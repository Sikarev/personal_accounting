// Стили графиков — только здесь, в ленивом чанке отчётов: в первую загрузку не попадают.
import '@mantine/charts/styles.layer.css'

import { CompositeChart } from '@mantine/charts'
import { useNavigate } from 'react-router'

import type { MonthlyReportItem } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { formatMoneyCompact } from '../../shared/lib/moneyCompact'
import { Money } from '../../shared/ui'
import { chartColors, layout } from '../../theme'
import { ChartReadout } from './ChartReadout'
import { monthFeedLink, type ReportFilters, type ReportKind } from './reportFilters'
import { axisMin, monthLabel, monthTick } from './trendReport'
import { useChartSelection } from './useChartSelection'
import classes from './ReportsPage.module.css'

type Row = { month: string; income: number; expense: number; difference: number }

/** Ширина оси сумм, px: «−1,25 млн ₽» шрифтом 12 px. */
const Y_AXIS_WIDTH = 76
/** Высота оси месяцев, px: месяц и под ним год. */
const X_AXIS_HEIGHT = 40

/**
 * Доходы и расходы по месяцам (requirements 5.10): сгруппированные столбцы и линия
 * разницы. `CompositeChart` Mantine, а не `BarChart` с дорисованной линией: столбцы
 * и линия в одном графике recharts (`ComposedChart`) делят одну ось и одну подсказку,
 * линия разницы — обычная серия со своим стилем.
 *
 * Разница отличается от столбцов не только цветом: линия пунктиром и с точками.
 * Анимации нет (у Mantine она выключена). График скрыт от диктора и не в порядке Tab:
 * эквивалент — таблица под ним, переход в ленту с клавиатуры — её ссылками.
 *
 * Мышь: наведение показывает суммы месяца под графиком, клик по столбцу — лента
 * с расходами или доходами месяца. Палец: первое касание показывает суммы, второе
 * по столбцу того же месяца — открывает ленту.
 */
export function MonthlyChart({
  items,
  currency,
  filters,
}: {
  items: MonthlyReportItem[]
  currency: string
  filters: ReportFilters
}) {
  const t = useT()
  const navigate = useNavigate()
  const selection = useChartSelection()

  const data: Row[] = items.map((item) => ({
    month: item.month,
    income: item.income,
    expense: item.expense,
    difference: item.income - item.expense,
  }))
  const minValue = axisMin(data.map((row) => row.difference))

  const onBar = (kind: ReportKind) => (_: unknown, index: number) => {
    const row = data[index]
    if (!row) return
    if (selection.byMouse() || (selection.touched && selection.active === index)) {
      navigate(monthFeedLink(filters, row.month, kind))
      return
    }
    selection.select(index)
  }

  const shown = data[selection.active ?? data.length - 1]

  return (
    <div className={classes.trendChart} aria-hidden {...selection.wrapperProps}>
      <CompositeChart
        h={layout.trendChartHeight}
        data={data}
        dataKey="month"
        series={[
          {
            name: 'income',
            label: t.reports.monthly.series.income,
            color: chartColors.income,
            type: 'bar',
          },
          {
            name: 'expense',
            label: t.reports.monthly.series.expense,
            color: chartColors.expense,
            type: 'bar',
          },
          {
            name: 'difference',
            label: t.reports.monthly.series.difference,
            color: chartColors.line,
            type: 'line',
            strokeDasharray: '6 4',
          },
        ]}
        curveType="linear"
        maxBarWidth={24}
        valueFormatter={(value) => formatMoneyCompact(value, currency)}
        // Своя подсказка — под графиком (ChartReadout); от recharts остаётся только
        // подсветка выбранного месяца.
        tooltipProps={{ content: () => null }}
        // Без слоя доступности recharts: он делает график фокусируемым, а график скрыт
        // от диктора — фокус внутри скрытого блока запрещён.
        accessibilityLayer={false}
        xAxisProps={{
          height: X_AXIS_HEIGHT,
          tick: (props: TickProps) => <MonthTick {...props} />,
          // По этой строке recharts меряет подписи и решает, какие пропустить: без неё он
          // мерил бы «2025-12-01» и на широком экране выбрасывал каждый второй месяц.
          tickFormatter: (value: string) => monthTick(value, 1, t).label,
        }}
        yAxisProps={{ width: Y_AXIS_WIDTH, domain: [minValue, 'auto'] }}
        referenceLines={minValue < 0 ? [{ y: 0, color: chartColors.zero }] : undefined}
        barProps={(series) => ({
          cursor: 'pointer',
          onClick: onBar(series.name as ReportKind),
        })}
        composedChartProps={selection.chartHandlers}
      />
      {shown && (
        <ChartReadout
          title={monthLabel(shown.month, t)}
          items={[
            {
              key: 'income',
              label: t.reports.monthly.series.income,
              marker: 'bar',
              color: chartColors.income,
              value: <Money amount={shown.income} currency={currency} roundToMajor />,
            },
            {
              key: 'expense',
              label: t.reports.monthly.series.expense,
              marker: 'bar',
              color: chartColors.expense,
              value: <Money amount={shown.expense} currency={currency} roundToMajor />,
            },
            {
              key: 'difference',
              label: t.reports.monthly.series.difference,
              marker: 'dashed',
              color: chartColors.line,
              value: (
                <Money amount={shown.difference} currency={currency} roundToMajor variant="flow" />
              ),
            },
          ]}
          hint={selection.touched && selection.active !== null ? t.reports.monthly.tapAgain : null}
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

/** Подпись месяца на оси: «ноя», под ней год — у первого месяца и у января. */
function MonthTick({ x, y, payload }: TickProps) {
  const t = useT()
  if (!payload) return null
  const { label, year } = monthTick(payload.value, payload.index, t)
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
