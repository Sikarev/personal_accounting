import { AppShell, Button, Group, NavLink, Stack, Text, ThemeIcon } from '@mantine/core'
import { IconHomeDollar, IconLogout, IconPlus } from '@tabler/icons-react'
import { NavLink as RouterNavLink, useLocation } from 'react-router'

import { useLogoutAction } from '../../features/auth/useLogoutAction'
import { useOnboarding } from '../../features/onboarding/onboardingContext'
import { useQuickAdd } from '../../features/quick-add/quickAddContext'
import { useT } from '../../shared/i18n'
import { icons } from '../../theme'
import { isNavItemActive, paths, sidebarItems } from '../navigation'
import { ApiStatus } from './ApiStatus'
import classes from './Sidebar.module.css'

/** Боковое меню desktop: логотип, заметная кнопка добавления операции и разделы. */
export function Sidebar() {
  const t = useT()
  const quickAdd = useQuickAdd()
  // Онбординг (шаг 2) показывает, где вносить операции, — кнопка выделена кольцом.
  const { introVisible } = useOnboarding()
  const { pathname } = useLocation()
  const { logout, isPending: loggingOut } = useLogoutAction()

  return (
    // AppShell.Navbar — это <nav>. В мобильной раскладке AppLayout его не рендерит вовсе.
    <AppShell.Navbar aria-label={t.nav.label} className={classes.navbar}>
      <AppShell.Section className={classes.top}>
        <Group gap="sm" wrap="nowrap" className={classes.brand}>
          <ThemeIcon size="lg" radius="md" aria-hidden>
            <IconHomeDollar size={icons.size.md} stroke={icons.stroke} />
          </ThemeIcon>
          <Text fw={600} size="sm" lh="xs">
            {t.app.name}
          </Text>
        </Group>
        <Button
          fullWidth
          size="md"
          // Высота как у size="md" (удобно попасть), но текст — как у пунктов меню,
          // иначе «Добавить операцию» не помещается в ширину бокового меню.
          // Размер шрифта Mantine задаёт inline-переменной, поэтому меняем через vars.
          vars={() => ({ root: { '--button-fz': 'var(--mantine-font-size-sm)' } })}
          leftSection={<IconPlus size={icons.size.md} stroke={icons.stroke} />}
          onClick={quickAdd.open}
          aria-haspopup="dialog"
          className={classes.add}
          data-highlight={introVisible || undefined}
        >
          {t.nav.addTransaction}
        </Button>
      </AppShell.Section>

      <AppShell.Section grow className={classes.links}>
        <Stack gap="xs">
          {sidebarItems.map((item) => (
            <NavLink
              key={item.to}
              component={RouterNavLink}
              to={item.to}
              end={item.to === paths.home}
              // Mantine не знает об адресе роутера — активность считаем сами.
              active={isNavItemActive(item, pathname)}
              label={t.nav[item.label]}
              leftSection={<item.icon size={icons.size.md} stroke={icons.stroke} />}
              className={classes.link}
            />
          ))}
        </Stack>
      </AppShell.Section>

      <AppShell.Section className={classes.footer}>
        <Stack gap="md">
          <NavLink
            component="button"
            type="button"
            label={t.auth.logout}
            leftSection={<IconLogout size={icons.size.md} stroke={icons.stroke} />}
            onClick={logout}
            disabled={loggingOut}
            className={classes.link}
          />
          {import.meta.env.DEV && <ApiStatus />}
        </Stack>
      </AppShell.Section>
    </AppShell.Navbar>
  )
}
