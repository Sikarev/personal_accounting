import { Skeleton, VisuallyHidden } from '@mantine/core'

import { useT } from '../../../shared/i18n'
import classes from './CategoryTreeSkeleton.module.css'

// Форма дерева: категории верхнего уровня и под некоторыми — подкатегории с отступом.
// Ширины фиксированы — скриншотные тесты стабильны.
const ROWS: { depth: 0 | 1; width: string }[] = [
  { depth: 0, width: '40%' },
  { depth: 1, width: '32%' },
  { depth: 1, width: '44%' },
  { depth: 0, width: '52%' },
  { depth: 0, width: '36%' },
  { depth: 1, width: '28%' },
  { depth: 0, width: '46%' },
]

/** Скелетон дерева категорий (ux.md, раздел 4). Показывать через `useDelayedLoading`. */
export function CategoryTreeSkeleton() {
  const t = useT()
  return (
    <div role="status" aria-live="polite">
      <VisuallyHidden>{t.common.loading}</VisuallyHidden>
      <div aria-hidden className={classes.root}>
        {ROWS.map((row, i) => (
          <div key={i} className={classes.row} data-depth={row.depth}>
            <Skeleton className={classes.handle} radius="sm" />
            <Skeleton className={classes.name} w={row.width} radius="sm" />
          </div>
        ))}
      </div>
    </div>
  )
}
