import { Button } from '@mantine/core'

import { useT } from '../../shared/i18n'
import { COLLAPSED_ROWS } from './trendReport'
import classes from './ReportsPage.module.css'

/**
 * «Показать все значения (121)» / «Свернуть» под длинной таблицей трендов. Кнопка
 * управляет таблицей (`aria-controls`, `aria-expanded`): диктор слышит, что строк больше,
 * и раскрывает их той же кнопкой. Короткой таблице кнопка не нужна.
 */
export function ShowAllButton({
  total,
  expanded,
  onToggle,
  controls,
}: {
  total: number
  expanded: boolean
  onToggle: () => void
  controls: string
}) {
  const t = useT()
  if (total <= COLLAPSED_ROWS) return null
  return (
    <Button
      variant="subtle"
      size="md"
      className={classes.showAll}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
    >
      {expanded ? t.reports.table.showLess : t.reports.table.showAll(total)}
    </Button>
  )
}
