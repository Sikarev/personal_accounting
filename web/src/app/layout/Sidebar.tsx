import { AppShell, Button, Group, NavLink, Stack, Text, ThemeIcon } from '@mantine/core'
import { IconHomeDollar, IconPlus } from '@tabler/icons-react'
import { NavLink as RouterNavLink, useLocation } from 'react-router'

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
  const { pathname } = useLocation()

  return (
    // AppShell.Navbar — это <nav>. На mobile «свёрнутое» меню Mantine лишь сдвигает за край
    // экрана, и его ссылки остались бы доступны с клавиатуры; visibleFrom убирает его целиком.
    <AppShell.Navbar visibleFrom="sm" aria-label={t.nav.label} className={classes.navbar}>
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
          leftSection={<IconPlus size={icons.size.md} stroke={2} />}
          onClick={quickAdd.open}
          aria-haspopup="dialog"
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

      {import.meta.env.DEV && (
        <AppShell.Section className={classes.footer}>
          <ApiStatus />
        </AppShell.Section>
      )}
    </AppShell.Navbar>
  )
}
