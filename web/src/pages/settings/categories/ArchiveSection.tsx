import { Button, Collapse, Text, UnstyledButton } from '@mantine/core'
import { IconChevronDown } from '@tabler/icons-react'
import { useId, useState } from 'react'

import { useT } from '../../../shared/i18n'
import { CATEGORY_PATH_SEPARATOR, type ArchivedEntry } from '../../../shared/lib/categoryTree'
import { icons } from '../../../theme'
import classes from './ArchiveSection.module.css'

/**
 * Свёрнутый блок «Архив (N)» внизу вкладки. Архивная подкатегория показана как
 * «Родитель › Подкатегория»; «Вернуть» у родителя возвращает и подкатегории, ушедшие
 * в архив вместе с ним, у подкатегории — и её архивного родителя (docs/data-model.md).
 */
export function ArchiveSection({
  entries,
  onRestore,
}: {
  entries: readonly ArchivedEntry[]
  onRestore: (id: string) => void
}) {
  const t = useT()
  const [opened, setOpened] = useState(false)
  const panelId = useId()

  if (entries.length === 0) return null

  return (
    <section className={classes.root}>
      <UnstyledButton
        className={classes.toggle}
        aria-expanded={opened}
        aria-controls={panelId}
        onClick={() => setOpened((o) => !o)}
      >
        <Text fw={500}>{t.categories.archiveTitle(entries.length)}</Text>
        <IconChevronDown
          size={icons.size.md}
          stroke={icons.stroke}
          className={classes.chevron}
          data-opened={opened || undefined}
          aria-hidden
        />
      </UnstyledButton>
      <Collapse expanded={opened} id={panelId}>
        <Text size="sm" c="dimmed" mb="sm">
          {t.categories.archiveHint}
        </Text>
        <ul className={classes.list}>
          {entries.map(({ category, parent }) => (
            <li key={category.id} className={classes.row} data-nested={parent ? true : undefined}>
              <Text className={classes.name} truncate="end">
                {parent && (
                  <Text span c="dimmed">
                    {parent.name}
                    {CATEGORY_PATH_SEPARATOR}
                  </Text>
                )}
                {category.name}
              </Text>
              <Button
                variant="subtle"
                size="sm"
                className={classes.restore}
                aria-label={t.categories.restoreLabel(category.name)}
                onClick={() => onRestore(category.id)}
              >
                {t.categories.restore}
              </Button>
            </li>
          ))}
        </ul>
      </Collapse>
    </section>
  )
}
