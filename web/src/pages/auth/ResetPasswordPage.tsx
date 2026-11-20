import { Button, Stack, Text, Title } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconLinkOff } from '@tabler/icons-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { paths } from '../../app/navigation'
import { useCompleteSignIn } from '../../features/auth/session'
import { useConfirmPasswordReset } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { useFormState } from '../../shared/lib/useFormState'
import { AuthLayout, EmptyState, PasswordField } from '../../shared/ui'
import { AuthForm } from './AuthForm'
import { submitErrorState } from './submitErrorState'

const MIN_PASSWORD = 8

/**
 * Новый пароль по ссылке из письма (`/reset-password?token=…`). Успех возвращает `Me`
 * и cookie новой сессии — пользователь сразу внутри, на главной.
 */
export function ResetPasswordPage() {
  const t = useT()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const completeSignIn = useCompleteSignIn()
  const form = useFormState({ password: '' })
  const [formError, setFormError] = useState<{ text: string; retryable: boolean } | null>(null)
  const [tokenInvalid, setTokenInvalid] = useState(false)
  const confirm = useConfirmPasswordReset()

  if (!token || tokenInvalid) return <InvalidLink />

  const submit = () => {
    const { password } = form.values
    setFormError(null)
    if (!password) {
      form.showErrors({ password: t.auth.validation.passwordRequired })
      return
    }
    if (password.length < MIN_PASSWORD) {
      form.showErrors({ password: t.auth.validation.passwordTooShort })
      return
    }
    form.setErrors({})
    confirm.mutate(
      { data: { token, password } },
      {
        onSuccess: (me) => {
          completeSignIn(me, paths.home)
          notifications.show({ message: t.auth.reset.success })
        },
        onError: (error) => {
          const state = submitErrorState(error, t, ['password', 'token'], {
            password: {
              too_short: t.auth.validation.passwordTooShort,
              too_long: t.auth.validation.passwordTooLong,
              required: t.auth.validation.passwordRequired,
            },
          })
          // Токен неверный, просрочен или уже использован — форма бесполезна,
          // нужен новый запрос письма.
          if (state.fieldErrors.token) {
            setTokenInvalid(true)
            return
          }
          form.showErrors(state.fieldErrors)
          setFormError(
            state.formError ? { text: state.formError, retryable: state.retryable } : null,
          )
        },
      },
    )
  }

  return (
    <AuthLayout>
      <Stack gap="xs" mb="lg">
        <Title order={1} size="xl">
          {t.auth.reset.title}
        </Title>
        <Text size="sm" c="dimmed">
          {t.auth.reset.description}
        </Text>
      </Stack>
      <AuthForm
        onSubmit={submit}
        errorsShown={form.errorsShown}
        error={formError?.text ?? null}
        retryable={formError?.retryable}
        submitLabel={t.auth.reset.submit}
        pending={confirm.isPending}
      >
        <PasswordField
          label={t.auth.fields.newPassword}
          description={t.auth.fields.passwordHint}
          autoComplete="new-password"
          maxLength={128}
          required
          withAsterisk={false}
          value={form.values.password}
          onChange={(e) => form.setValue('password', e.currentTarget.value)}
          error={form.errors.password}
        />
      </AuthForm>
    </AuthLayout>
  )
}

function InvalidLink() {
  const t = useT()
  return (
    <AuthLayout>
      <EmptyState
        icon={IconLinkOff}
        titleOrder={1}
        title={t.auth.reset.invalidTitle}
        description={t.auth.reset.invalidDescription}
        action={
          <Button component={Link} to={paths.forgotPassword} variant="light" size="md">
            {t.auth.reset.requestNew}
          </Button>
        }
      />
    </AuthLayout>
  )
}
