import { Badge } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'

import { useT } from '../../shared/i18n'

/**
 * Связаны ли фронт, API и Postgres. Только для разработки: в production-сборке
 * компонент не рендерится (см. `import.meta.env.DEV` в местах использования),
 * а запрос к /healthz не выполняется.
 */
export function ApiStatus() {
  const t = useT()
  const { data, isError } = useQuery({
    queryKey: ['healthz'],
    queryFn: async () => {
      const res = await fetch('/healthz')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as { status: string }
    },
    refetchInterval: 30_000,
    retry: false,
  })

  // Вариант dot: цвет точки дублируется текстом, так что смысл не держится на одном цвете.
  const [color, label] = isError
    ? ['red', t.apiStatus.unavailable]
    : data
      ? ['green', t.apiStatus.ok]
      : ['gray', t.apiStatus.checking]

  return (
    <Badge variant="dot" color={color} size="sm" tt="none" fw={500} title={t.apiStatus.label}>
      {label}
    </Badge>
  )
}
