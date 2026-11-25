import { Text } from '@mantine/core'
import type { CSSProperties, ReactNode } from 'react'

import classes from './ReportsPage.module.css'

export type ReadoutItem = {
  key: string
  label: string
  /** Как серия выглядит на графике: столбец (квадрат цвета), линия или пунктир. */
  marker: 'bar' | 'line' | 'dashed'
  color: string
  value: ReactNode
}

/**
 * Легенда и подсказка графика трендов в одном блоке под графиком: что за точка (месяц,
 * неделя) и значения серий рядом с их обозначениями. Без наведения показана последняя
 * точка — блок не пустует и не меняет высоту при наведении.
 *
 * Как и график, скрыт от диктора: полный текстовый эквивалент — таблица ниже.
 */
export function ChartReadout({
  title,
  items,
  hint,
}: {
  title: string
  items: ReadoutItem[]
  /** Пояснение под значениями (касание: «Коснитесь ещё раз…»). */
  hint?: string | null
}) {
  return (
    <div className={classes.readout}>
      <Text size="sm" fw={600}>
        {title}
      </Text>
      <ul className={classes.legend}>
        {items.map((item) => (
          <li key={item.key} className={classes.legendItem}>
            <span
              className={classes.legendMarker}
              data-marker={item.marker}
              style={{ '--marker-color': item.color } as CSSProperties}
            />
            <Text component="span" size="sm" c="dimmed">
              {item.label}
            </Text>
            <Text component="span" size="sm" fw={500}>
              {item.value}
            </Text>
          </li>
        ))}
      </ul>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </div>
  )
}
