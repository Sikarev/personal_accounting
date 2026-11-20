import { Anchor, Button, Stack, Text, TextInput, Title } from '@mantine/core'
import { IconMailForward } from '@tabler/icons-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router'

import { paths } from '../../app/navigation'
import { useRequestPasswordReset } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { useFormState } from '../../shared/lib/useFormState'
import { AuthLayout, EmptyState } from '../../shared/ui'
import { AuthForm } from './AuthForm'
import { submitErrorState } from './submitErrorState'
import classes from './auth.module.css'

/**
 * «Забыли пароль?»: e-mail → письмо со ссылкой на `/reset-password`.
 *
 * API отвечает 202 всегда — есть такой аккаунт или нет (иначе по ответу можно было бы
 * проверять, кто зарегистрирован). Поэтому и экран после отправки говорит «если аккаунт есть».
 */
export function ForgotPasswordPage() {
  const t = useT()
  const location = useLocation()
  // E-mail из формы входа (ссылка «Забыли пароль?» передаёт его в state перехода).
  const initialEmail = (location.state as { email?: unknown } | null)?.email
  const form = useFormState({ email: typeof initialEmail === 'string' ? initialEmail : '' })
  const [formError, setFormError] = useState<{ text: string; retryable: boolean } | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const request = useRequestPasswordReset()

  const submit = () => {
    const email = form.values.email.trim()
    setFormError(null)
    if (!email) {
      form.showErrors({ email: t.auth.validation.emailRequired })
      return
    }
    form.setErrors({})
    request.mutate(
      { data: { email } },
      {
        onSuccess: () => setSentTo(email),
        onError: (error) => {
          const state = submitErrorState(error, t, ['email'], {
            email: {
              invalid_format: t.auth.validation.emailInvalid,
              required: t.auth.validation.emailRequired,
            },
          })
          form.showErrors(state.fieldErrors)
          setFormError(
            state.formError ? { text: state.formError, retryable: state.retryable } : null,
          )
        },
      },
    )
  }

  if (sentTo !== null) {
    return (
      <AuthLayout>
        <EmptyState
          icon={IconMailForward}
          titleOrder={1}
          title={t.auth.forgot.sentTitle}
          description={t.auth.forgot.sentDescription(sentTo)}
          action={
            <Stack gap="sm" align="center" className={classes.actions}>
              <Text size="sm" c="dimmed" ta="center">
                {t.auth.forgot.sentHint}
              </Text>
              <Button variant="light" size="md" onClick={() => setSentTo(null)}>
                {t.auth.forgot.otherEmail}
              </Button>
              <Anchor component={Link} to={paths.login} className={classes.link}>
                {t.auth.forgot.backToLogin}
              </Anchor>
            </Stack>
          }
        />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <Stack gap="xs" mb="lg">
        <Title order={1} size="xl">
          {t.auth.forgot.title}
        </Title>
        <Text size="sm" c="dimmed">
          {t.auth.forgot.description}
        </Text>
      </Stack>
      <AuthForm
        onSubmit={submit}
        errorsShown={form.errorsShown}
        error={formError?.text ?? null}
        retryable={formError?.retryable}
        submitLabel={t.auth.forgot.submit}
        pending={request.isPending}
      >
        <TextInput
          size="md"
          label={t.auth.fields.email}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={254}
          required
          withAsterisk={false}
          value={form.values.email}
          onChange={(e) => form.setValue('email', e.currentTarget.value)}
          error={form.errors.email}
        />
      </AuthForm>
      <Anchor component={Link} to={paths.login} className={classes.link} mt="sm">
        {t.auth.forgot.backToLogin}
      </Anchor>
    </AuthLayout>
  )
}
