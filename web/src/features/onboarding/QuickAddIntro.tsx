import { Button, Group, Paper, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import { IconCircleCheck, IconPlus } from '@tabler/icons-react'
import { useEffect, useId, useRef } from 'react'

import { useQuickAdd } from '../quick-add/quickAddContext'
import { useT } from '../../shared/i18n'
import { useMobileLayout } from '../../shared/lib/useMobileLayout'
import { icons } from '../../theme'
import { useOnboarding } from './onboardingContext'
import classes from './Onboarding.module.css'

/**
 * Онбординг, шаг 2: первый счёт создан — показываем, где вносить операции. Пока карточка
 * видна, оболочка выделяет кнопку «+» / «Добавить операцию» (`useOnboarding().introVisible`).
 *
 * При появлении фокус переходит на карточку: кнопка «Создать счёт» исчезла вместе с формой,
 * и экранный диктор прочитает заголовок и подсказку — результат действия.
 */
export function QuickAddIntro({ onDismiss }: { onDismiss: () => void }) {
  const t = useT()
  const mobile = useMobileLayout()
  const quickAdd = useQuickAdd()
  const { hideIntro } = useOnboarding()
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const hintId = useId()

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <Paper
      ref={ref}
      component="section"
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={hintId}
      withBorder
      radius="lg"
      p={mobile ? 'md' : 'lg'}
      className={classes.intro}
    >
      <Stack gap="md" align="flex-start">
        <ThemeIcon size={icons.badgeSize} radius="xl" variant="light" aria-hidden>
          <IconCircleCheck size={icons.size.xl} stroke={icons.stroke} />
        </ThemeIcon>
        <Stack gap="xs">
          <Title order={2} size="lg" id={titleId}>
            {t.onboarding.introTitle}
          </Title>
          <Text id={hintId}>
            {mobile ? t.onboarding.introHintMobile : t.onboarding.introHintDesktop}
          </Text>
        </Stack>
        <Group gap="sm" className={classes.actions} data-mobile={mobile || undefined}>
          <Button
            size="md"
            leftSection={<IconPlus size={icons.size.md} stroke={icons.stroke} />}
            onClick={quickAdd.open}
            aria-haspopup="dialog"
          >
            {t.onboarding.addFirst}
          </Button>
          <Button
            size="md"
            variant="default"
            onClick={() => {
              hideIntro()
              onDismiss()
            }}
          >
            {t.onboarding.dismiss}
          </Button>
        </Group>
      </Stack>
    </Paper>
  )
}
