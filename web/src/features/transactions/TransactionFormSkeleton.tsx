import { Skeleton, VisuallyHidden } from '@mantine/core'

import { useT } from '../../shared/i18n'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import classes from './TransactionFormSkeleton.module.css'

/**
 * Скелетон формы операции: переключатель вида, строка «счёт · дата», сумма, чипы,
 * комментарий. Появляется, только если загрузка дольше 300 мс (ux.md, §4).
 *
 * Отдельный лёгкий модуль: его показывает и сама форма (пока грузятся данные), и окно
 * быстрого ввода, пока грузится чанк формы, — поэтому он не должен тянуть форму за собой.
 */
export function TransactionFormSkeleton() {
  const t = useT()
  const show = useDelayedLoading(true)
  if (!show) return null
  return (
    <div role="status" aria-live="polite">
      <VisuallyHidden>{t.common.loading}</VisuallyHidden>
      <div className={classes.skeleton} aria-hidden>
        <Skeleton className={classes.skeletonKinds} radius="md" />
        <Skeleton className={classes.skeletonRow} radius="md" />
        <Skeleton className={classes.skeletonField} radius="md" />
        <Skeleton className={classes.skeletonChips} radius="md" />
        <Skeleton className={classes.skeletonField} radius="md" />
      </div>
    </div>
  )
}
