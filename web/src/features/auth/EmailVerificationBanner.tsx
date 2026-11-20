import { Button, CloseButton, Group, Paper, Text, ThemeIcon } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconMail } from '@tabler/icons-react'
import { useId, useState } from 'react'

import { apiErrorText, useGetMe, useResendVerificationEmail } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { icons } from '../../theme'
import classes from './EmailVerificationBanner.module.css'
import { dismissVerifyBanner, isVerifyBannerDismissed } from './verifyBannerDismissal'

/**
 * Напоминание «Подтвердите e-mail» вверху контента. Подтверждение мягкое
 * (docs/api.md): приложением можно пользоваться и без него, поэтому плашка спокойная,
 * в потоке страницы (не поверх нижней панели) и скрывается до следующего входа.
 */
export function EmailVerificationBanner() {
  const t = useT()
  const titleId = useId()
  const me = useGetMe()
  const user = me.data?.user
  const [dismissed, setDismissed] = useState(() => !!user && isVerifyBannerDismissed(user.id))

  const resend = useResendVerificationEmail({
    mutation: {
      onSuccess: () => {
        if (user) notifications.show({ message: t.auth.banner.resent(user.email) })
      },
      onError: (error) => {
        notifications.show({ color: 'red', message: apiErrorText(error, t) })
      },
    },
  })

  if (!user || user.emailVerified || dismissed) return null

  const dismiss = () => {
    dismissVerifyBanner(user.id)
    setDismissed(true)
  }

  return (
    <Paper
      component="section"
      aria-labelledby={titleId}
      withBorder
      radius="lg"
      className={classes.root}
    >
      <Group wrap="nowrap" align="flex-start" gap="md">
        <ThemeIcon variant="light" size="lg" radius="md" aria-hidden>
          <IconMail size={icons.size.md} stroke={icons.stroke} />
        </ThemeIcon>
        <div className={classes.body}>
          <Text id={titleId} fw={600} size="md">
            {t.auth.banner.title}
          </Text>
          <Text size="sm" c="dimmed" className={classes.description}>
            {t.auth.banner.description(user.email)}
          </Text>
          <Button
            variant="light"
            size="md"
            mt="sm"
            loading={resend.isPending}
            onClick={() => resend.mutate()}
          >
            {t.auth.banner.resend}
          </Button>
        </div>
        <CloseButton
          size="lg"
          aria-label={t.auth.banner.hide}
          onClick={dismiss}
          className={classes.close}
        />
      </Group>
    </Paper>
  )
}
