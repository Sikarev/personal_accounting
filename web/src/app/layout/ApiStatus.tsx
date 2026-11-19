import { Badge, Group } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'

import { useListCurrencies } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { formatCount } from '../../shared/lib/plural'

/**
 * Связаны ли фронт, API и Postgres. Только для разработки: в production-сборке
 * компонент не рендерится (см. `import.meta.env.DEV` в местах использования),
 * а запросы не выполняются.
 *
 * Два бейджа: `/healthz` (вне контракта, обычный fetch) и число валют через
 * сгенерированный orval хук — проверка всей цепочки клиента.
 */
export function ApiStatus() {
  const t = useT()
  const health = useQuery({
    queryKey: ['healthz'],
    queryFn: async () => {
      const res = await fetch('/healthz')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as { status: string }
    },
    refetchInterval: 30_000,
    retry: false,
  })
  const currencies = useListCurrencies()

  // Вариант dot: цвет точки дублируется текстом, так что смысл не держится на одном цвете.
  const [healthColor, healthLabel] = health.isError
    ? ['red', t.apiStatus.unavailable]
    : health.data
      ? ['green', t.apiStatus.ok]
      : ['gray', t.apiStatus.checking]

  const [currenciesColor, currenciesLabel] = currencies.isError
    ? ['red', t.apiStatus.currenciesError]
    : currencies.data
      ? ['green', formatCount(currencies.data.items.length, t.apiStatus.currencies)]
      : ['gray', t.apiStatus.currenciesChecking]

  return (
    <Group gap="xs" title={t.apiStatus.label}>
      <Badge variant="dot" color={healthColor} size="sm" tt="none" fw={500}>
        {healthLabel}
      </Badge>
      <Badge variant="dot" color={currenciesColor} size="sm" tt="none" fw={500}>
        {currenciesLabel}
      </Badge>
    </Group>
  )
}
