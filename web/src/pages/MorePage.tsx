import { Box, NavLink, Paper, ThemeIcon } from '@mantine/core'
import { IconChevronRight, IconLogout } from '@tabler/icons-react'
import { Link } from 'react-router'

import { moreItems } from '../app/navigation'
import { ApiStatus } from '../app/layout/ApiStatus'
import { useLogoutAction } from '../features/auth/useLogoutAction'
import { useT } from '../shared/i18n'
import { PageHeader } from '../shared/ui'
import { icons } from '../theme'
import classes from './MorePage.module.css'

/** Экран «Ещё» (mobile): разделы, которым не хватило места в нижней панели. */
export function MorePage() {
  const t = useT()
  const { logout, isPending: loggingOut } = useLogoutAction()
  const descriptions: Record<string, string> = {
    accounts: t.pages.more.accountsDescription,
    settings: t.pages.more.settingsDescription,
  }

  return (
    <>
      <PageHeader title={t.nav.more} />
      <Paper withBorder radius="lg" className={classes.list}>
        {moreItems.map((item) => (
          <NavLink
            key={item.to}
            component={Link}
            to={item.to}
            label={t.nav[item.label]}
            description={descriptions[item.label]}
            leftSection={
              <ThemeIcon variant="light" size="lg" radius="md" aria-hidden>
                <item.icon size={icons.size.md} stroke={icons.stroke} />
              </ThemeIcon>
            }
            rightSection={
              <IconChevronRight
                size={icons.size.md}
                stroke={icons.stroke}
                className={classes.chevron}
                aria-hidden
              />
            }
            className={classes.item}
            classNames={{
              body: classes.body,
              label: classes.label,
              description: classes.description,
            }}
          />
        ))}
      </Paper>
      <Paper withBorder radius="lg" mt="lg" className={classes.list}>
        <NavLink
          component="button"
          type="button"
          label={t.auth.logout}
          onClick={logout}
          disabled={loggingOut}
          leftSection={
            <ThemeIcon variant="light" color="gray" size="lg" radius="md" aria-hidden>
              <IconLogout size={icons.size.md} stroke={icons.stroke} />
            </ThemeIcon>
          }
          className={classes.item}
          classNames={{ body: classes.body, label: classes.label }}
        />
      </Paper>
      {import.meta.env.DEV && (
        <Box mt="lg">
          <ApiStatus />
        </Box>
      )}
    </>
  )
}
