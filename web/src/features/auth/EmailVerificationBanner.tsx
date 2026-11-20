import { Button, CloseButton, Paper, Text, ThemeIcon } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconMail } from '@tabler/icons-react'
import { useId, useState } from 'react'

import { apiErrorText, useGetMe, useResendVerificationEmail } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { useMobileLayout } from '../../shared/lib/useMobileLayout'
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
  const mobile = useMobileLayout()
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
      {/* Сетка: крестик — только в строке заголовка, текст и кнопка под ним занимают всю
          ширину. Иначе на телефоне при крупном шрифте колонка крестика сужала текст. */}
      <div className={classes.grid} data-mobile={mobile || undefined}>
        {/* Иконка декоративная; на телефоне её нет — место нужнее тексту. */}
        {!mobile && (
          <ThemeIcon variant="light" size="lg" radius="md" aria-hidden className={classes.icon}>
            <IconMail size={icons.size.md} stroke={icons.stroke} />
          </ThemeIcon>
        )}
        <Text id={titleId} fw={600} size="md" className={classes.title}>
          {t.auth.banner.title}
        </Text>
        <CloseButton
          size="lg"
          aria-label={t.auth.banner.hide}
          onClick={dismiss}
          className={classes.close}
        />
        <Text size="sm" c="dimmed" className={classes.description}>
          {t.auth.banner.description(user.email)}
        </Text>
        <div className={classes.action}>
          <Button
            variant="light"
            size="md"
            loading={resend.isPending}
            onClick={() => resend.mutate()}
          >
            {t.auth.banner.resend}
          </Button>
        </div>
      </div>
    </Paper>
  )
}
