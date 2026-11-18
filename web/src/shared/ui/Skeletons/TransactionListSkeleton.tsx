import { Skeleton, VisuallyHidden } from '@mantine/core'

import { useT } from '../../i18n'
import classes from './TransactionListSkeleton.module.css'

export type TransactionListSkeletonProps = {
  /** Сколько дней-групп показать. */
  groups?: number
  /** Сколько строк операций в каждой группе. */
  rowsPerGroup?: number
}

// Ширины подобраны вручную и чередуются, чтобы заглушка выглядела как живой список,
// а не как ровная «лесенка». Детерминированы — скриншотные тесты стабильны.
const TITLE_WIDTHS = ['56%', '38%', '64%', '46%', '30%']
const META_WIDTHS = ['22%', '30%', '18%', '26%', '24%']
const AMOUNT_WIDTHS = ['4.5rem', '3.5rem', '5rem', '4rem', '3rem']

/**
 * Скелетон ленты операций: заголовок дня с итогом и строки «иконка · категория и счёт · сумма».
 * Повторяет форму будущего `TransactionRow`, чтобы при загрузке не прыгала вёрстка.
 * Показывайте вместе с `useDelayedLoading`, чтобы быстрый ответ не вызывал мигания.
 */
export function TransactionListSkeleton({
  groups = 2,
  rowsPerGroup = 3,
}: TransactionListSkeletonProps) {
  const t = useT()

  return (
    <div role="status" aria-live="polite" className={classes.root}>
      <VisuallyHidden>{t.common.loading}</VisuallyHidden>
      {Array.from({ length: groups }, (_, group) => (
        <div key={group} className={classes.group} aria-hidden>
          <div className={classes.header}>
            <Skeleton className={classes.headerDate} radius="sm" />
            <Skeleton className={classes.headerTotal} radius="sm" />
          </div>
          {Array.from({ length: rowsPerGroup }, (_, row) => {
            const i = (group * rowsPerGroup + row) % TITLE_WIDTHS.length
            return (
              <div key={row} className={classes.row}>
                <Skeleton circle className={classes.icon} />
                <div className={classes.text}>
                  <Skeleton className={classes.title} w={TITLE_WIDTHS[i]} radius="sm" />
                  <Skeleton className={classes.meta} w={META_WIDTHS[i]} radius="sm" />
                </div>
                <Skeleton className={classes.amount} w={AMOUNT_WIDTHS[i]} radius="sm" />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
