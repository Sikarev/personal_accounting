import { Button, Loader, Paper, Text } from '@mantine/core'
import { useState } from 'react'

import { apiErrorText } from '../../shared/api'
import { useT } from '../../shared/i18n'
import classes from './HomePage.module.css'

/**
 * Ошибка загрузки одного блока главной: что случилось и «Повторить» — в самом блоке,
 * остальные блоки работают (ux.md, раздел 4).
 *
 * Во время повтора блок остаётся на месте, а кнопка не блокируется (`disabled` увёл бы
 * фокус клавиатуры на body) — занятость показывают индикатор и `aria-busy`. Ошибку запрос
 * на время повтора сбрасывает — показываем последнюю известную.
 */
export function BlockError({
  title,
  error,
  retrying,
  onRetry,
}: {
  /** «Не удалось загрузить счета.» */
  title: string
  /** Ошибка запроса; `null` во время повтора — тогда текст прежней ошибки. */
  error: unknown
  /** Повторный запрос идёт — индикатор на кнопке. */
  retrying: boolean
  onRetry: () => void
}) {
  const t = useT()
  const [lastError, setLastError] = useState(error)
  // Только запоминаем новую ошибку, не сбрасываем: поправка состояния в рендере без цикла.
  if (error && error !== lastError) setLastError(error)
  return (
    <Paper withBorder radius="lg" p="md" className={classes.blockError}>
      <div className={classes.blockErrorText}>
        <Text fw={500}>{title}</Text>
        <Text size="sm" c="dimmed">
          {apiErrorText(error ?? lastError, t)}
        </Text>
      </div>
      <Button
        variant="default"
        size="md"
        className={classes.touchButton}
        aria-busy={retrying || undefined}
        rightSection={retrying ? <Loader size="xs" aria-hidden /> : null}
        onClick={() => {
          if (!retrying) onRetry()
        }}
      >
        {t.errors.retry}
      </Button>
    </Paper>
  )
}
