import { Anchor, Checkbox, Group, Text, TextInput, VisuallyHidden } from '@mantine/core'
import { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'

import { paths } from '../../app/navigation'
import { browserTimezone, useCompleteSignIn } from '../../features/auth/session'
import { useLogin, useRegister } from '../../shared/api'
import { useT, type Messages } from '../../shared/i18n'
import { safeNextPath } from '../../shared/lib/safeNext'
import { submitErrorState } from '../../shared/lib/submitErrorState'
import { useFormState, type FormErrors } from '../../shared/lib/useFormState'
import { AuthLayout, PasswordField, SubmitForm } from '../../shared/ui'
import classes from './AuthPage.module.css'

export type AuthMode = 'login' | 'register'

/** Ограничения длины из контракта (`RegisterRequest`): браузер не даст ввести больше. */
const MAX_LENGTH = { name: 100, email: 254, password: 128 } as const
const MIN_PASSWORD = 8

type Values = { name: string; email: string; password: string; acceptTerms: boolean }

/** Клиентская проверка — только очевидное; остальное проверит сервер. */
function validate(mode: AuthMode, v: Values, t: Messages): FormErrors {
  const errors: FormErrors = {}
  if (mode === 'register' && !v.name.trim()) errors.name = t.auth.validation.nameRequired
  if (!v.email.trim()) errors.email = t.auth.validation.emailRequired
  if (!v.password) errors.password = t.auth.validation.passwordRequired
  else if (mode === 'register' && v.password.length < MIN_PASSWORD) {
    errors.password = t.auth.validation.passwordTooShort
  }
  if (mode === 'register' && !v.acceptTerms) errors.acceptTerms = t.auth.validation.consentRequired
  return errors
}

/**
 * Вход и регистрация — одна форма с переключателем (roadmap, этап 1) на двух адресах,
 * `/login` и `/register`, чтобы на каждый можно было дать ссылку. Оба маршрута рисуют
 * этот компонент на одном месте дерева, поэтому при переключении введённые e-mail
 * и пароль сохраняются.
 */
export function AuthPage({ mode }: { mode: AuthMode }) {
  const t = useT()
  const location = useLocation()
  const [params] = useSearchParams()
  const completeSignIn = useCompleteSignIn()
  const form = useFormState<Values>({ name: '', email: '', password: '', acceptTerms: false })
  const [formError, setFormError] = useState<{ text: string; retryable: boolean } | null>(null)

  const login = useLogin()
  const register = useRegister()
  const pending = login.isPending || register.isPending
  const isRegister = mode === 'register'
  const next = safeNextPath(params.get('next'))

  const fieldOverrides = {
    email: {
      email_taken: t.auth.validation.emailTaken,
      invalid_format: t.auth.validation.emailInvalid,
      required: t.auth.validation.emailRequired,
    },
    password: {
      too_short: t.auth.validation.passwordTooShort,
      too_long: t.auth.validation.passwordTooLong,
      required: t.auth.validation.passwordRequired,
    },
    name: { required: t.auth.validation.nameRequired },
  }

  const onError = (error: unknown) => {
    const fields = isRegister ? ['name', 'email', 'password'] : ['email', 'password']
    const state = submitErrorState(error, t, fields, fieldOverrides)
    form.showErrors(state.fieldErrors)
    setFormError(state.formError ? { text: state.formError, retryable: state.retryable } : null)
  }

  const submit = () => {
    const errors = validate(mode, form.values, t)
    form.showErrors(errors)
    setFormError(null)
    if (Object.keys(errors).length > 0) return

    const { name, email, password } = form.values
    if (isRegister) {
      register.mutate(
        {
          data: {
            name: name.trim(),
            email: email.trim(),
            password,
            timezone: browserTimezone(),
            acceptTerms: true,
          },
        },
        { onSuccess: (me) => completeSignIn(me, next), onError },
      )
    } else {
      login.mutate(
        { data: { email: email.trim(), password } },
        { onSuccess: (me) => completeSignIn(me, next), onError },
      )
    }
  }

  // Переключение режима сбрасывает ошибки: они относились к другой форме.
  const resetErrors = () => {
    form.setErrors({})
    setFormError(null)
  }

  const title = isRegister ? t.auth.register.title : t.auth.login.title

  return (
    <AuthLayout>
      <VisuallyHidden component="h1">{title}</VisuallyHidden>
      <nav aria-label={t.auth.modeLabel} className={classes.switch}>
        {(['login', 'register'] as const).map((m) => (
          <Link
            key={m}
            // Параметры (в том числе next) сохраняются: после регистрации тоже вернёмся туда.
            to={{ pathname: m === 'login' ? paths.login : paths.register, search: location.search }}
            replace
            className={classes.switchItem}
            data-active={m === mode || undefined}
            aria-current={m === mode ? 'page' : undefined}
            onClick={m === mode ? undefined : resetErrors}
          >
            {m === 'login' ? t.auth.login.tab : t.auth.register.tab}
          </Link>
        ))}
      </nav>

      <SubmitForm
        onSubmit={submit}
        errorsShown={form.errorsShown}
        error={formError?.text ?? null}
        retryable={formError?.retryable}
        submitLabel={isRegister ? t.auth.register.submit : t.auth.login.submit}
        pending={pending}
      >
        {isRegister && (
          <TextInput
            size="md"
            label={t.auth.fields.name}
            autoComplete="name"
            autoCapitalize="words"
            maxLength={MAX_LENGTH.name}
            required
            withAsterisk={false}
            value={form.values.name}
            onChange={(e) => form.setValue('name', e.currentTarget.value)}
            error={form.errors.name}
          />
        )}
        <TextInput
          size="md"
          label={t.auth.fields.email}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={MAX_LENGTH.email}
          required
          withAsterisk={false}
          value={form.values.email}
          onChange={(e) => form.setValue('email', e.currentTarget.value)}
          error={form.errors.email}
        />
        <div>
          <PasswordField
            label={t.auth.fields.password}
            description={isRegister ? t.auth.fields.passwordHint : undefined}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            maxLength={MAX_LENGTH.password}
            required
            withAsterisk={false}
            value={form.values.password}
            onChange={(e) => form.setValue('password', e.currentTarget.value)}
            error={form.errors.password}
          />
          {!isRegister && (
            <Group justify="flex-end">
              <Anchor
                component={Link}
                to={paths.forgotPassword}
                // E-mail переносится в форму восстановления — не вводить его второй раз.
                state={{ email: form.values.email.trim() }}
                size="sm"
                className={classes.forgot}
              >
                {t.auth.login.forgotPassword}
              </Anchor>
            </Group>
          )}
        </div>
        {isRegister && (
          <Checkbox
            size="md"
            checked={form.values.acceptTerms}
            onChange={(e) => form.setValue('acceptTerms', e.currentTarget.checked)}
            error={form.errors.acceptTerms}
            aria-invalid={!!form.errors.acceptTerms || undefined}
            label={<ConsentLabel />}
            classNames={{ label: classes.consentLabel }}
          />
        )}
      </SubmitForm>
    </AuthLayout>
  )
}

/**
 * Подпись согласия со ссылками на документы. Документы открываются в новой вкладке:
 * переход в этой же вкладке стёр бы заполненную форму.
 */
function ConsentLabel() {
  const t = useT()
  const r = t.auth.register
  const docLink = (to: string, text: string) => (
    <Anchor component={Link} to={to} target="_blank" rel="noopener" inherit>
      {text}
      <VisuallyHidden> {r.opensInNewTab}</VisuallyHidden>
    </Anchor>
  )
  return (
    <Text component="span" inherit>
      {r.consentStart}
      {docLink(paths.legalTerms, r.consentTerms)}
      {r.consentMiddle}
      {docLink(paths.legalPrivacy, r.consentPrivacy)}
    </Text>
  )
}
