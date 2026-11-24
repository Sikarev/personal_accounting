import { Paper, Title } from '@mantine/core'
import { lazy, Suspense, useId } from 'react'

import { ChunkLoadBoundary } from '../../features/transactions/ChunkLoadBoundary'
import { TransactionFormSkeleton } from '../../features/transactions/TransactionFormSkeleton'
import { useT } from '../../shared/i18n'
import { HOME_FORM } from './focusTargets'
import classes from './HomePage.module.css'

// Форма операции с пикерами — отдельным чанком, тем же, что у окна быстрого ввода:
// первая загрузка (ux.md, раздел 8) её не включает. Главная на desktop начинает грузить
// чанк сразу, пока идут запросы данных.
const TransactionForm = lazy(() =>
  import('../../features/transactions/TransactionForm').then((m) => ({
    default: m.TransactionForm,
  })),
)

/**
 * Форма быстрого ввода прямо на главной (desktop, ux.md «Главная»): всегда под рукой.
 * Та же форма, что в окне: после сохранения — тост с «Отменить», форма очищается, фокус
 * в сумме. При загрузке страницы фокус сюда не ставится — не перехватываем клавиатуру
 * и экранного диктора.
 */
export function HomeQuickAddForm() {
  const t = useT()
  const titleId = useId()
  return (
    <Paper
      component="section"
      aria-labelledby={titleId}
      withBorder
      radius="lg"
      p="lg"
      // Цель фокуса, пока форма грузится (focusHomeForm) — только программно.
      tabIndex={-1}
      className={classes.formCard}
      {...{ [HOME_FORM]: true }}
    >
      <Title id={titleId} order={2} size="lg" className={classes.formTitle}>
        {t.home.formTitle}
      </Title>
      <ChunkLoadBoundary>
        <Suspense fallback={<TransactionFormSkeleton />}>
          <TransactionForm />
        </Suspense>
      </ChunkLoadBoundary>
    </Paper>
  )
}
