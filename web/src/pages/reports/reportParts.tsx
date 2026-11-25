import { Button, Text } from '@mantine/core'
import { IconAlertCircle, IconInfoCircle, IconPlus, type Icon } from '@tabler/icons-react'
import type { ReactNode } from 'react'

import { useQuickAdd } from '../../features/quick-add/quickAddContext'
import { apiErrorText } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { EmptyState } from '../../shared/ui'
import { icons } from '../../theme'
import type { FailingQuery } from './reportQuery'
import classes from './ReportsPage.module.css'

// Общие блоки вкладок отчётов: состояния «ошибка», «нет операций» и «слишком длинный
// период», предупреждение о валютах без курса, рамка устаревшего отчёта.

/** Отчёт не загрузился: что случилось и «Повторить». */
export function ReportError({ failed }: { failed: readonly FailingQuery[] }) {
  const t = useT()
  return (
    <div className={classes.card}>
      <EmptyState
        icon={IconAlertCircle}
        title={t.reports.loadError}
        description={apiErrorText(failed[0]?.error ?? null, t)}
        action={
          <Button
            variant="default"
            size="md"
            className={classes.touchButton}
            loading={failed.some((q) => q.isFetching)}
            onClick={() => failed.forEach((q) => void q.refetch())}
          >
            {t.errors.retry}
          </Button>
        }
      />
    </div>
  )
}

/** Период длиннее, чем принимает API: объясняем словами, без запроса. */
export function TooLongState() {
  const t = useT()
  return (
    <div className={classes.card}>
      <EmptyState
        icon={IconInfoCircle}
        title={t.reports.tooLong.title}
        description={t.reports.tooLong.description}
      />
    </div>
  )
}

/** Валюты без единого курса ЦБ: их операции (у баланса — счета) в отчёт не вошли. */
export function MissingRatesNotice({
  codes,
  text,
}: {
  codes: readonly string[]
  /** Свой текст (баланс — про счета, а не операции); по умолчанию — про операции. */
  text?: string
}) {
  const t = useT()
  if (codes.length === 0) return null
  return (
    <div className={classes.notice}>
      <IconInfoCircle
        size={icons.size.md}
        stroke={icons.stroke}
        aria-hidden
        className={classes.noticeIcon}
      />
      <Text size="sm">{text ?? t.reports.missingRates(codes)}</Text>
    </div>
  )
}

/**
 * Обёртка показанного отчёта: устаревший (пока грузится отчёт по новым фильтрам) приглушён
 * и инертен — ссылки и график не ведут по прежним данным.
 */
export function ReportFrame({ stale, children }: { stale: boolean; children: ReactNode }) {
  return (
    <div className={classes.stack} data-stale={stale || undefined} inert={stale}>
      {children}
    </div>
  )
}

/**
 * За период нет операций. С фильтром счетов или участника объясняем ими и предлагаем
 * их сбросить; без фильтров — внести операцию (период и так виден в фильтрах).
 */
export function NoOperationsState({
  icon,
  title,
  filtered,
  onResetFilters,
}: {
  icon: Icon
  title: string
  filtered: boolean
  onResetFilters: () => void
}) {
  const t = useT()
  const quickAdd = useQuickAdd()
  return (
    <div className={classes.card}>
      <EmptyState
        icon={icon}
        title={title}
        description={filtered ? t.reports.empty.filteredDescription : t.reports.empty.description}
        action={
          filtered ? (
            <Button variant="default" size="md" onClick={onResetFilters}>
              {t.reports.empty.resetFilters}
            </Button>
          ) : (
            <Button
              variant="light"
              size="md"
              leftSection={<IconPlus size={icons.size.md} stroke={icons.stroke} />}
              onClick={() => quickAdd.open()}
            >
              {t.nav.addTransaction}
            </Button>
          )
        }
      />
    </div>
  )
}
