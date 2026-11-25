// Стили графиков — только здесь, в ленивом чанке отчётов: в первую загрузку не попадают.
import '@mantine/charts/styles.layer.css'

import { DonutChart } from '@mantine/charts'
import { Text } from '@mantine/core'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { useT } from '../../shared/i18n'
import { Money } from '../../shared/ui'
import { chartColors, layout } from '../../theme'
import { OTHER_COLOR, type Segment } from './categoryReport'
import { feedLink, type ReportFilters } from './reportFilters'
import { formatShare } from './reportPeriod'
import classes from './ReportsPage.module.css'

/** Толщина кольца, px; диаметр — `layout.chartSize`. */
const THICKNESS = 36

const OTHER_KEY = 'other'

/**
 * Кольцо расходов (доходов) по категориям верхнего уровня (ux.md, «Отчёты»).
 *
 * Кольцо — наглядность для глаз: полный текстовый эквивалент — таблица рядом, поэтому
 * кольцо скрыто от экранного диктора и не в порядке Tab (переход в ленту с клавиатуры —
 * из строк таблицы). Анимации нет вовсе: появление графика при загрузке — декоративная
 * анимация (ux.md, раздел 7), заодно соблюдается `prefers-reduced-motion`.
 *
 * Мышь: наведение показывает под кольцом название, сумму и долю, клик — лента с этой
 * категорией. Палец: первое касание показывает сумму, второе по тому же сегменту —
 * открывает ленту (иначе сумму на телефоне не увидеть: касание сразу уводило бы с экрана).
 * У «Прочего» перехода нет — в таблице все категории по отдельности.
 */
export function CategoryDonut({
  segments,
  total,
  currency,
  filters,
  active,
  onActiveChange,
}: {
  segments: Segment[]
  total: number
  currency: string
  filters: ReportFilters
  /** Ключ подсвеченного сегмента: id категории или `other`. */
  active: string | null
  onActiveChange: (key: string | null) => void
}) {
  const t = useT()
  const navigate = useNavigate()
  // Чем указали на сегмент: мышью или пальцем (pointerdown приходит раньше click
  // и раньше эмулированных после касания mouseenter).
  const pointer = useRef('mouse')
  const [touched, setTouched] = useState(false)

  const keyOf = (segment: Segment) => segment.categoryId ?? OTHER_KEY
  const activeSegment = segments.find((s) => keyOf(s) === active) ?? null

  const select = (index: number, how: 'hover' | 'click') => {
    const segment = segments[index]
    if (!segment) return
    const key = keyOf(segment)
    const byMouse = pointer.current === 'mouse'
    if (how === 'hover') {
      if (byMouse) onActiveChange(key)
      return
    }
    if (segment.categoryId !== null && (byMouse || active === key)) {
      navigate(feedLink(filters, segment.categoryId))
      return
    }
    setTouched(!byMouse)
    onActiveChange(key)
  }

  return (
    <div
      className={classes.chart}
      aria-hidden
      onPointerDown={(e) => {
        pointer.current = e.pointerType
      }}
      onMouseLeave={() => {
        if (pointer.current === 'mouse') onActiveChange(null)
      }}
    >
      <DonutChart
        data={segments.map((segment) => ({
          name: keyOf(segment),
          value: segment.amount,
          color:
            segment.color === OTHER_COLOR ? chartColors.other : chartColors.series[segment.color],
        }))}
        size={layout.chartSize}
        // Рамка графика у Mantine — в rem (растёт со шрифтом), а кольцо recharts — в пикселях:
        // при шрифте 200 % рамка вдвое шире кольца и вылезала бы за экран.
        vars={() => ({ root: { '--chart-size': 'var(--app-chart-size)' } })}
        thickness={THICKNESS}
        // Сегменты разделены линией цвета фона: соседние цвета близки по яркости, граница
        // помогает различать их и без различения тона.
        strokeWidth={2}
        withTooltip={false}
        // Без слоя доступности recharts: он делает график фокусируемым и управляемым
        // стрелками, а здесь график скрыт от диктора — фокус внутри скрытого блока запрещён.
        accessibilityLayer={false}
        cellProps={(cell) => ({
          // Подсвеченный сегмент ярче остальных; курсор — только там, где есть переход.
          fillOpacity: active === null || cell.name === active ? 1 : 0.35,
          cursor: cell.name === OTHER_KEY ? 'default' : 'pointer',
        })}
        pieProps={{
          // Сам сектор-группу recharts тоже ставит в порядок Tab (tabindex="0") — убираем.
          rootTabIndex: -1,
          onMouseEnter: (_: unknown, index: number) => select(index, 'hover'),
          onClick: (_: unknown, index: number) => select(index, 'click'),
        }}
      />
      {/* Под кольцом — выбранный сегмент; место занято всегда, чтобы вёрстка не прыгала. */}
      <div className={classes.chartCaption}>
        {activeSegment && (
          <>
            <Text size="sm" fw={500} className={classes.chartCaptionName}>
              {activeSegment.categoryId === null
                ? t.reports.table.other
                : (activeSegment.name ?? t.feed.filters.unknownCategory)}
            </Text>
            <Text size="sm">
              <Money amount={activeSegment.amount} currency={currency} roundToMajor />
              {' · '}
              {formatShare(activeSegment.amount, total, t)}
            </Text>
            {touched && activeSegment.categoryId !== null && (
              <Text size="xs" c="dimmed">
                {t.reports.chart.tapAgain}
              </Text>
            )}
          </>
        )}
      </div>
    </div>
  )
}
