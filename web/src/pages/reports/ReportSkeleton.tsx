import { Skeleton, VisuallyHidden } from '@mantine/core'

import { useT } from '../../shared/i18n'
import classes from './ReportsPage.module.css'

// Ширины строк таблицы чередуются, чтобы заглушка выглядела как живой список.
// Детерминированы — скриншотные тесты стабильны.
const NAME_WIDTHS = ['52%', '38%', '60%', '44%', '30%']

/**
 * Скелетон отчёта в форме будущего содержимого (ux.md, раздел 4): строка вывода, кольцо
 * и строки таблицы. Показывается, только если ответ дольше 300 мс (`useDelayedLoading`).
 */
export function ReportSkeleton() {
  const t = useT()
  return (
    <div role="status" aria-live="polite" className={classes.report}>
      <VisuallyHidden>{t.common.loading}</VisuallyHidden>
      <div className={classes.headline} aria-hidden>
        <Skeleton className={classes.skeletonHeadline} radius="sm" />
        <Skeleton className={classes.skeletonComparison} radius="sm" />
      </div>
      <div className={classes.reportBody} aria-hidden>
        <div className={classes.chart}>
          <Skeleton circle className={classes.skeletonDonut} />
        </div>
        <div className={classes.skeletonRows}>
          {NAME_WIDTHS.map((width, i) => (
            <div key={i} className={classes.skeletonRow}>
              <Skeleton className={classes.skeletonName} w={width} radius="sm" />
              <Skeleton className={classes.skeletonAmount} radius="sm" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
