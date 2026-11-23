import { Alert, Anchor, Stack, Text, Title } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import { Link } from 'react-router'

import { paths } from '../app/navigation'
import { useT } from '../shared/i18n'
import { AuthLayout } from '../shared/ui'
import { icons } from '../theme'
import classes from './LegalPage.module.css'

/**
 * Документы, на которые ссылается согласие при регистрации. Доступны без входа.
 * Пока заглушки (техдолг №11): настоящие тексты нужны до запуска.
 */
export function LegalPage({ doc }: { doc: 'privacy' | 'terms' }) {
  const t = useT()
  const content = t.legal[doc]

  return (
    <AuthLayout width="reading">
      <Stack gap="md">
        <Title order={1} size="xl">
          {content.title}
        </Title>
        <Alert variant="light" icon={<IconInfoCircle size={icons.size.md} stroke={icons.stroke} />}>
          {t.legal.draftNotice}
        </Alert>
        {content.paragraphs.map((p) => (
          <Text key={p}>{p}</Text>
        ))}
        <Anchor component={Link} to={paths.home} className={classes.link}>
          {t.legal.back}
        </Anchor>
      </Stack>
    </AuthLayout>
  )
}
