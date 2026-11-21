import { NavLink, Paper, Text, ThemeIcon } from '@mantine/core'
import { IconCategory, IconChevronRight } from '@tabler/icons-react'
import { Link } from 'react-router'

import { paths } from '../../app/navigation'
import { useT } from '../../shared/i18n'
import { PageHeader } from '../../shared/ui'
import { icons } from '../../theme'
// Тот же вид списка разделов, что на экране «Ещё».
import classes from '../MorePage.module.css'

/**
 * Меню настроек. Пока в нём только «Категории»: профиль, семья и данные появятся на этапе 5
 * (roadmap) — до тех пор их нет в списке, а не «мёртвые» ссылки.
 */
export function SettingsPage() {
  const t = useT()
  const sections = [
    {
      to: paths.settingsCategories,
      label: t.categories.title,
      description: t.settings.categoriesDescription,
      icon: IconCategory,
    },
  ]

  return (
    <>
      <PageHeader title={t.nav.settings} />
      <Paper withBorder radius="lg" className={classes.list}>
        {sections.map((item) => (
          <NavLink
            key={item.to}
            component={Link}
            to={item.to}
            label={item.label}
            description={item.description}
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
      <Text size="sm" c="dimmed" mt="md">
        {t.settings.comingSoon}
      </Text>
    </>
  )
}
