import { AppShell, Badge, Burger, Group, NavLink, Text, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import { NavLink as RouterLink, Route, Routes } from 'react-router'

const navItems = [
  { to: '/', label: 'Главная' },
  { to: '/transactions', label: 'Операции' },
  { to: '/reports', label: 'Отчёты' },
  { to: '/accounts', label: 'Счета' },
  { to: '/settings', label: 'Настройки' },
]

export function App() {
  const [opened, { toggle, close }] = useDisclosure()

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={4}>Домашняя бухгалтерия</Title>
          </Group>
          <ApiStatus />
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            component={RouterLink}
            to={item.to}
            label={item.label}
            onClick={close}
            end={item.to === '/'}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          {navItems.map((item) => (
            <Route key={item.to} path={item.to} element={<Placeholder title={item.label} />} />
          ))}
        </Routes>
      </AppShell.Main>
    </AppShell>
  )
}

function Placeholder({ title }: { title: string }) {
  return (
    <>
      <Title order={2} mb="sm">
        {title}
      </Title>
      <Text c="dimmed">Экран в разработке.</Text>
    </>
  )
}

// Показывает, доступен ли API и БД — проверка, что фронт, бэк и Postgres связаны.
function ApiStatus() {
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

  if (isError) return <Badge color="red">API недоступен</Badge>
  if (!data) return <Badge color="gray">API…</Badge>
  return <Badge color="teal">API: {data.status}</Badge>
}
