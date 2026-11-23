import { Paper, Stack, Text } from '@mantine/core'
import { useMemo } from 'react'

// Форма счёта живёт у экрана «Счета». Этот модуль грузится лениво (см. HomePage),
// поэтому общий с «Счетами» код уходит в отдельный чанк, а не в первую загрузку.
import { AccountForm, type AccountPreset } from '../../pages/accounts/AccountForm'
import { useListCurrencies } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { useMobileLayout } from '../../shared/lib/useMobileLayout'
import { PageHeader } from '../../shared/ui'
import { useOnboarding } from './onboardingContext'
import classes from './Onboarding.module.css'

/**
 * Онбординг, шаг 1: у пользователя ещё нет ни одного счёта. Одна фраза о том, что такое
 * счёт, чипы частых вариантов и компактная форма. Других счетов не навязываем — одного
 * хватит, остальные добавляются потом на экране «Счета».
 *
 * После создания `AccountForm` кладёт счёт в кэш списка и перезапрашивает его (как на
 * экране «Счета»), а мы в том же обработчике включаем шаг 2 — React применяет оба
 * изменения одним рендером, поэтому главная не мигает обычным содержимым.
 * Тост не нужен: карточка шага 2 сама говорит «Готово».
 */
export function FirstAccountStep() {
  const t = useT()
  const mobile = useMobileLayout()
  const { showIntro } = useOnboarding()
  const currencies = useListCurrencies().data?.items ?? []

  const presets = useMemo<AccountPreset[]>(
    () => [
      { label: t.onboarding.presets.card, name: t.onboarding.presets.card, type: 'card' },
      { label: t.onboarding.presets.cash, name: t.onboarding.presets.cash, type: 'cash' },
      {
        label: t.onboarding.presets.creditCard,
        name: t.onboarding.presets.creditCard,
        type: 'credit_card',
      },
    ],
    [t],
  )

  return (
    <div className={classes.step}>
      <PageHeader title={t.onboarding.title} />
      <Paper withBorder radius="lg" p={mobile ? 'md' : 'lg'}>
        <Stack gap="lg">
          <Text>{t.onboarding.lead}</Text>
          <AccountForm
            account={null}
            currencies={currencies}
            onDone={showIntro}
            presets={presets}
            compact
          />
        </Stack>
      </Paper>
    </div>
  )
}
