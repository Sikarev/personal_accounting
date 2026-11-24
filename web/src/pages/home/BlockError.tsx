import { Button, Paper, Text } from '@mantine/core'

import { apiErrorText } from '../../shared/api'
import { useT } from '../../shared/i18n'
import classes from './HomePage.module.css'

/**
 * Ошибка загрузки одного блока главной: что случилось и «Повторить» — в самом блоке,
 * остальные блоки работают (ux.md, раздел 4).
 */
export function BlockError({
  title,
  error,
  retrying,
  onRetry,
}: {
  /** «Не удалось загрузить счета.» */
  title: string
  error: unknown
  /** Повторный запрос идёт — индикатор на кнопке. */
  retrying: boolean
  onRetry: () => void
}) {
  const t = useT()
  return (
    <Paper withBorder radius="lg" p="md" className={classes.blockError}>
      <div className={classes.blockErrorText}>
        <Text fw={500}>{title}</Text>
        <Text size="sm" c="dimmed">
          {apiErrorText(error, t)}
        </Text>
      </div>
      <Button
        variant="default"
        size="md"
        className={classes.touchButton}
        loading={retrying}
        onClick={onRetry}
      >
        {t.errors.retry}
      </Button>
    </Paper>
  )
}
