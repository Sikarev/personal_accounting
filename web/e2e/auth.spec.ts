import { expect, test, type Page } from '@playwright/test'

import { ru as t } from '../src/shared/i18n/ru.ts'
import {
  API,
  enlargeFont,
  expectNoAxeViolations,
  fontsReady,
  horizontalOverflow,
  meFixture,
  mockSignedIn,
  mockSignedOut,
  problem,
} from './support.ts'

// Вход, регистрация, восстановление пароля, подтверждение e-mail, защита маршрутов.
// API подменяется через page.route: под `vite preview` бэкенда нет.

const EMAIL = 'anna@example.com'
const PASSWORD = 'correct-horse-1'

/** Число и слово в «через 5 минут» соединены неразрывным пробелом. */
function plain(text: string | null) {
  return (text ?? '').replace(/ /g, ' ')
}

async function ready(page: Page, heading: string) {
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeAttached()
  await fontsReady(page)
}

const emailField = (page: Page) => page.getByLabel(t.auth.fields.email)
const passwordField = (page: Page, label: string = t.auth.fields.password) =>
  page.getByLabel(label, { exact: true })

async function openLogin(page: Page, path = '/login') {
  await page.goto(path)
  await ready(page, t.auth.login.title)
}

async function openRegister(page: Page) {
  await page.goto('/register')
  await ready(page, t.auth.register.title)
}

test.describe('вход', () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedOut(page)
  })

  test('скриншот', { tag: '@visual' }, async ({ page }) => {
    await openLogin(page)
    await expect(page).toHaveScreenshot('login.png')
  })

  test('доступность', { tag: '@a11y' }, async ({ page }) => {
    await openLogin(page)
    await expectNoAxeViolations(page)
    // Атрибуты для менеджеров паролей и мобильной клавиатуры.
    await expect(emailField(page)).toHaveAttribute('type', 'email')
    await expect(emailField(page)).toHaveAttribute('autocomplete', 'email')
    await expect(emailField(page)).toHaveAttribute('autocapitalize', 'none')
    await expect(passwordField(page)).toHaveAttribute('autocomplete', 'current-password')
  })

  test('неверный пароль: сообщение над формой', { tag: '@visual' }, async ({ page }) => {
    await page.route(`**${API}/auth/login`, (route) => problem(route, 401, 'invalid_credentials'))
    await openLogin(page)
    await emailField(page).fill(EMAIL)
    await passwordField(page).fill('wrong-password')
    await page.getByRole('button', { name: t.auth.login.submit }).click()
    await expect(page.getByRole('alert')).toHaveText(t.errors.invalidCredentials)
    await expect(page).toHaveScreenshot('login-invalid-credentials.png')
  })

  test(
    'неверный пароль: доступность и введённое сохраняется',
    { tag: '@a11y' },
    async ({ page }) => {
      await page.route(`**${API}/auth/login`, (route) => problem(route, 401, 'invalid_credentials'))
      await openLogin(page)
      await emailField(page).fill(EMAIL)
      await passwordField(page).fill('wrong-password')
      await passwordField(page).press('Enter')
      await expect(page.getByRole('alert')).toHaveText(t.errors.invalidCredentials)
      // 401 неверного пароля — не «сессия кончилась»: остаёмся на экране входа.
      await expect(page).toHaveURL(/\/login$/)
      await expect(emailField(page)).toHaveValue(EMAIL)
      await expectNoAxeViolations(page)
    },
  )

  test('лимит попыток: «через N минут» по Retry-After', { tag: '@a11y' }, async ({ page }) => {
    await page.route(`**${API}/auth/login`, (route) =>
      problem(route, 429, 'too_many_requests', { retryAfter: 241 }),
    )
    await openLogin(page)
    await emailField(page).fill(EMAIL)
    await passwordField(page).fill(PASSWORD)
    await page.getByRole('button', { name: t.auth.login.submit }).click()
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    expect(plain(await alert.textContent())).toBe(
      'Слишком много попыток. Попробуйте через 5 минут.',
    )
  })

  test('нет сети: сообщение, повтор и введённое на месте', { tag: '@a11y' }, async ({ page }) => {
    let attempts = 0
    await page.route(`**${API}/auth/login`, (route) => {
      attempts += 1
      if (attempts === 1) return route.abort('internetdisconnected')
      return route.fulfill({ json: meFixture() })
    })
    await openLogin(page)
    await emailField(page).fill(EMAIL)
    await passwordField(page).fill(PASSWORD)
    await page.getByRole('button', { name: t.auth.login.submit }).click()
    const alert = page.getByRole('alert')
    await expect(alert).toContainText(t.errors.network)
    await expect(emailField(page)).toHaveValue(EMAIL)
    await expect(passwordField(page)).toHaveValue(PASSWORD)
    await expectNoAxeViolations(page)

    await mockSignedIn(page)
    await alert.getByRole('button', { name: t.errors.retry }).click()
    await expect(page).toHaveURL(/\/$/)
    expect(attempts).toBe(2)
  })

  test(
    'пустые поля: ошибки у полей, фокус на первом, запроса нет',
    { tag: '@a11y' },
    async ({ page }) => {
      let requests = 0
      await page.route(`**${API}/auth/login`, (route) => {
        requests += 1
        return route.fulfill({ json: meFixture() })
      })
      await openLogin(page)
      await page.getByRole('button', { name: t.auth.login.submit }).click()
      await expect(page.getByText(t.auth.validation.emailRequired)).toBeVisible()
      await expect(page.getByText(t.auth.validation.passwordRequired)).toBeVisible()
      await expect(emailField(page)).toBeFocused()
      await expect(emailField(page)).toHaveAttribute('aria-invalid', 'true')
      expect(requests).toBe(0)
    },
  )

  test('кнопка «Показать пароль» работает с клавиатуры', { tag: '@a11y' }, async ({ page }) => {
    await openLogin(page)
    await passwordField(page).fill(PASSWORD)
    await passwordField(page).press('Tab')
    const toggle = page.getByRole('button', { name: t.auth.showPassword })
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(passwordField(page)).toHaveAttribute('type', 'text')
    const box = await toggle.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(44)
  })
})

test.describe('регистрация', () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedOut(page)
  })

  test('скриншот', { tag: '@visual' }, async ({ page }) => {
    await openRegister(page)
    await expect(page).toHaveScreenshot('register.png')
  })

  test('доступность и атрибуты полей', { tag: '@a11y' }, async ({ page }) => {
    await openRegister(page)
    await expectNoAxeViolations(page)
    await expect(page.getByLabel(t.auth.fields.name)).toHaveAttribute('autocomplete', 'name')
    await expect(passwordField(page)).toHaveAttribute('autocomplete', 'new-password')
    // Документы открываются в новой вкладке — заполненная форма не теряется.
    for (const name of [t.auth.register.consentTerms, t.auth.register.consentPrivacy]) {
      await expect(page.getByRole('link', { name })).toHaveAttribute('target', '_blank')
    }
  })

  test(
    'переключатель меняет адрес и сохраняет введённое и next',
    { tag: '@a11y' },
    async ({ page }) => {
      await openLogin(page, '/login?next=%2Freports')
      await emailField(page).fill(EMAIL)
      const modes = page.getByRole('navigation', { name: t.auth.modeLabel })
      await expect(modes.getByRole('link', { name: t.auth.login.tab })).toHaveAttribute(
        'aria-current',
        'page',
      )
      await modes.getByRole('link', { name: t.auth.register.tab }).click()
      await expect(page).toHaveURL(/\/register\?next=%2Freports$/)
      await expect(page.getByLabel(t.auth.fields.name)).toBeVisible()
      await expect(emailField(page)).toHaveValue(EMAIL)
    },
  )

  test('успех: часовой пояс браузера, переход на next', { tag: '@a11y' }, async ({ page }) => {
    let body: Record<string, unknown> | undefined
    await page.route(`**${API}/auth/register`, async (route) => {
      body = route.request().postDataJSON()
      await mockSignedIn(page)
      return route.fulfill({ status: 201, json: meFixture({ emailVerified: false }) })
    })
    await page.goto('/register?next=%2Freports')
    await ready(page, t.auth.register.title)
    await page.getByLabel(t.auth.fields.name).fill('  Анна ')
    await emailField(page).fill(EMAIL)
    await passwordField(page).fill(PASSWORD)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: t.auth.register.submit }).click()
    await expect(page).toHaveURL(/\/reports$/)
    expect(body).toEqual({
      name: 'Анна',
      email: EMAIL,
      password: PASSWORD,
      // timezoneId из playwright.config.ts.
      timezone: 'Europe/Moscow',
      acceptTerms: true,
    })
  })

  test('ошибки полей от сервера', { tag: '@visual' }, async ({ page }) => {
    await page.route(`**${API}/auth/register`, (route) =>
      problem(route, 422, 'validation_failed', {
        errors: [{ field: 'email', code: 'email_taken', message: 'E-mail уже занят.' }],
      }),
    )
    await openRegister(page)
    await page.getByLabel(t.auth.fields.name).fill('Анна')
    await emailField(page).fill(EMAIL)
    await passwordField(page).fill(PASSWORD)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: t.auth.register.submit }).click()
    await expect(page.getByText(t.auth.validation.emailTaken)).toBeVisible()
    await expect(page).toHaveScreenshot('register-field-errors.png')
  })

  test('ошибки полей: доступность и клиентская проверка', { tag: '@a11y' }, async ({ page }) => {
    await page.route(`**${API}/auth/register`, (route) =>
      problem(route, 422, 'validation_failed', {
        errors: [{ field: 'email', code: 'email_taken', message: 'E-mail уже занят.' }],
      }),
    )
    await openRegister(page)
    // Клиент проверяет только очевидное: пустые поля, длину пароля, согласие.
    await passwordField(page).fill('short')
    await page.getByRole('button', { name: t.auth.register.submit }).click()
    await expect(page.getByText(t.auth.validation.nameRequired)).toBeVisible()
    await expect(page.getByText(t.auth.validation.passwordTooShort)).toBeVisible()
    await expect(page.getByText(t.auth.validation.consentRequired)).toBeVisible()
    await expect(page.getByLabel(t.auth.fields.name)).toBeFocused()

    await page.getByLabel(t.auth.fields.name).fill('Анна')
    await emailField(page).fill(EMAIL)
    await passwordField(page).fill(PASSWORD)
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: t.auth.register.submit }).click()
    await expect(page.getByText(t.auth.validation.emailTaken)).toBeVisible()
    await expect(emailField(page)).toBeFocused()
    // Сообщение сервера (не из словаря) не показывается.
    await expect(page.getByText('E-mail уже занят.')).toHaveCount(0)
    await expectNoAxeViolations(page)
  })
})

test.describe('защита маршрутов', () => {
  test('без входа: защищённый адрес → /login?next=', { tag: '@a11y' }, async ({ page }) => {
    await mockSignedOut(page)
    await page.goto('/accounts?tab=personal')
    await expect(page).toHaveURL(/\/login\?next=%2Faccounts%3Ftab%3Dpersonal$/)
    await expect(passwordField(page)).toBeVisible()
  })

  test('без входа: главная → /login без next', { tag: '@a11y' }, async ({ page }) => {
    await mockSignedOut(page)
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('после входа — на next', { tag: '@a11y' }, async ({ page }) => {
    await mockSignedOut(page)
    await page.route(`**${API}/auth/login`, async (route) => {
      await mockSignedIn(page)
      return route.fulfill({ json: meFixture() })
    })
    await page.goto('/reports')
    await expect(page).toHaveURL(/\/login\?next=%2Freports$/)
    await emailField(page).fill(EMAIL)
    await passwordField(page).fill(PASSWORD)
    await page.getByRole('button', { name: t.auth.login.submit }).click()
    await expect(page).toHaveURL(/\/reports$/)
    await expect(page.getByRole('heading', { level: 1, name: t.nav.reports })).toBeVisible()
  })

  for (const next of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)']) {
    test(`вошедший на /login?next=${next} → главная`, { tag: '@a11y' }, async ({ page }) => {
      await mockSignedIn(page)
      await page.goto(`/login?next=${encodeURIComponent(next)}`)
      await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/)
      await expect(page.getByRole('heading', { level: 1, name: t.nav.home })).toBeVisible()
    })
  }

  test(
    'сессия кончилась во время работы: 401 → вход с возвратом',
    { tag: '@a11y' },
    async ({ page }) => {
      await mockSignedIn(page, meFixture({ emailVerified: false }))
      await page.route(`**${API}/auth/verify-email/resend`, async (route) => {
        await mockSignedOut(page)
        return problem(route, 401, 'unauthorized')
      })
      await page.goto('/reports')
      await page.getByRole('button', { name: t.auth.banner.resend }).click()
      await expect(page).toHaveURL(/\/login\?next=%2Freports$/)
      await expect(passwordField(page)).toBeVisible()
    },
  )

  test('выход: на экран входа, кэш сброшен', { tag: '@a11y' }, async ({ page, isMobile }) => {
    await mockSignedIn(page)
    let loggedOut = false
    await page.route(`**${API}/auth/logout`, async (route) => {
      loggedOut = true
      await mockSignedOut(page)
      return route.fulfill({ status: 204 })
    })
    await page.goto(isMobile ? '/more' : '/')
    await page.getByRole('button', { name: t.auth.logout }).click()
    await expect(page).toHaveURL(/\/login$/)
    expect(loggedOut).toBe(true)
    // В приложение без входа не пускает: /me уже не из кэша, а с сервера (401).
    await page.goto('/accounts')
    await expect(page).toHaveURL(/\/login\?next=%2Faccounts$/)
  })

  test('выход без сети: остаёмся, видим ошибку', { tag: '@a11y' }, async ({ page, isMobile }) => {
    await mockSignedIn(page)
    await page.route(`**${API}/auth/logout`, (route) => route.abort('internetdisconnected'))
    const path = isMobile ? '/more' : '/'
    await page.goto(path)
    await page.getByRole('button', { name: t.auth.logout }).click()
    await expect(page.getByText(t.errors.network)).toBeVisible()
    await expect(page).not.toHaveURL(/\/login/)
  })
})

test.describe('восстановление пароля', () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedOut(page)
  })

  async function openForgot(page: Page) {
    await page.goto('/forgot-password')
    await ready(page, t.auth.forgot.title)
  }

  async function sendRequest(page: Page) {
    await page.route(`**${API}/auth/password-reset`, (route) => route.fulfill({ status: 202 }))
    await openForgot(page)
    await emailField(page).fill(EMAIL)
    await page.getByRole('button', { name: t.auth.forgot.submit }).click()
    await ready(page, t.auth.forgot.sentTitle)
  }

  test('запрос: скриншот', { tag: '@visual' }, async ({ page }) => {
    await openForgot(page)
    await expect(page).toHaveScreenshot('forgot-password.png')
  })

  test('запрос: доступность', { tag: '@a11y' }, async ({ page }) => {
    await openForgot(page)
    await expectNoAxeViolations(page)
  })

  test('e-mail переносится из формы входа', { tag: '@a11y' }, async ({ page }) => {
    await openLogin(page)
    await emailField(page).fill(EMAIL)
    await page.getByRole('link', { name: t.auth.login.forgotPassword }).click()
    await ready(page, t.auth.forgot.title)
    await expect(emailField(page)).toHaveValue(EMAIL)
  })

  test('письмо отправлено: скриншот', { tag: '@visual' }, async ({ page }) => {
    await sendRequest(page)
    // Курсор остался над кнопкой нового экрана — в кадре было бы состояние наведения.
    await page.mouse.move(0, 0)
    await expect(page).toHaveScreenshot('forgot-password-sent.png')
  })

  test(
    'письмо отправлено: доступность и текст без раскрытия аккаунта',
    { tag: '@a11y' },
    async ({ page }) => {
      await sendRequest(page)
      await expect(page.getByText(t.auth.forgot.sentDescription(EMAIL))).toBeVisible()
      await expectNoAxeViolations(page)
    },
  )

  test('новый пароль: скриншот', { tag: '@visual' }, async ({ page }) => {
    await page.goto('/reset-password?token=abc')
    await ready(page, t.auth.reset.title)
    await expect(page).toHaveScreenshot('reset-password.png')
  })

  test('новый пароль: доступность и успех — сразу внутри', { tag: '@a11y' }, async ({ page }) => {
    let body: unknown
    await page.route(`**${API}/auth/password-reset/confirm`, async (route) => {
      body = route.request().postDataJSON()
      await mockSignedIn(page)
      return route.fulfill({ json: meFixture() })
    })
    await page.goto('/reset-password?token=abc')
    await ready(page, t.auth.reset.title)
    await expectNoAxeViolations(page)
    await expect(passwordField(page, t.auth.fields.newPassword)).toHaveAttribute(
      'autocomplete',
      'new-password',
    )
    await passwordField(page, t.auth.fields.newPassword).fill('new-password-1')
    await page.getByRole('button', { name: t.auth.reset.submit }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText(t.auth.reset.success)).toBeVisible()
    expect(body).toEqual({ token: 'abc', password: 'new-password-1' })
  })

  test('недействительная ссылка: скриншот', { tag: '@visual' }, async ({ page }) => {
    await page.route(`**${API}/auth/password-reset/confirm`, (route) =>
      problem(route, 422, 'validation_failed', {
        errors: [{ field: 'token', code: 'invalid_token', message: 'x' }],
      }),
    )
    await page.goto('/reset-password?token=expired')
    await ready(page, t.auth.reset.title)
    await passwordField(page, t.auth.fields.newPassword).fill('new-password-1')
    await page.getByRole('button', { name: t.auth.reset.submit }).click()
    await ready(page, t.auth.reset.invalidTitle)
    await expect(page).toHaveScreenshot('reset-password-invalid.png')
  })

  test(
    'недействительная ссылка: доступность и путь к новому письму',
    { tag: '@a11y' },
    async ({ page }) => {
      // Ссылка без токена — то же состояние, без запроса.
      await page.goto('/reset-password')
      await ready(page, t.auth.reset.invalidTitle)
      await expectNoAxeViolations(page)
      await page.getByRole('link', { name: t.auth.reset.requestNew }).click()
      await ready(page, t.auth.forgot.title)
    },
  )
})

test.describe('подтверждение e-mail', () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedOut(page)
  })

  async function openVerify(page: Page, status: 'ok' | 'invalid') {
    let calls = 0
    await page.route(`**${API}/auth/verify-email`, (route) => {
      calls += 1
      return status === 'ok'
        ? route.fulfill({ status: 204 })
        : problem(route, 422, 'validation_failed', {
            errors: [{ field: 'token', code: 'invalid_token', message: 'x' }],
          })
    })
    await page.goto('/verify-email?token=abc')
    await ready(page, status === 'ok' ? t.auth.verify.successTitle : t.auth.verify.invalidTitle)
    return () => calls
  }

  test('успех: скриншот', { tag: '@visual' }, async ({ page }) => {
    await openVerify(page, 'ok')
    await expect(page).toHaveScreenshot('verify-email-success.png')
  })

  test(
    'успех: доступность, один запрос, без входа ведёт ко входу',
    { tag: '@a11y' },
    async ({ page }) => {
      const calls = await openVerify(page, 'ok')
      await expectNoAxeViolations(page)
      expect(calls()).toBe(1)
      await expect(page.getByRole('link', { name: t.auth.verify.toLogin })).toBeVisible()
    },
  )

  test('успех у вошедшего: плашка в оболочке исчезает', { tag: '@a11y' }, async ({ page }) => {
    let verified = false
    await page.route(`**${API}/me`, (route) =>
      route.fulfill({ json: meFixture({ emailVerified: verified }) }),
    )
    await page.route(`**${API}/auth/verify-email`, (route) => {
      verified = true
      return route.fulfill({ status: 204 })
    })
    await page.goto('/verify-email?token=abc')
    await ready(page, t.auth.verify.successTitle)
    await page.getByRole('link', { name: t.auth.verify.toHome }).click()
    await expect(page.getByRole('heading', { level: 1, name: t.nav.home })).toBeVisible()
    await expect(page.getByText(t.auth.banner.title)).toHaveCount(0)
  })

  test(
    'адрес с «/» на конце — тоже публичный, на вход не уводит',
    { tag: '@a11y' },
    async ({ page }) => {
      await page.route(`**${API}/auth/verify-email`, (route) => route.fulfill({ status: 204 }))
      await page.goto('/verify-email/?token=abc')
      await ready(page, t.auth.verify.successTitle)
      await expect(page).toHaveURL(/\/verify-email\/\?token=abc$/)
    },
  )

  test(
    'старая ссылка у уже подтвердившего — «адрес уже подтверждён»',
    { tag: '@a11y' },
    async ({ page }) => {
      await mockSignedIn(page)
      await page.route(`**${API}/auth/verify-email`, (route) =>
        problem(route, 422, 'validation_failed', {
          errors: [{ field: 'token', code: 'invalid_token', message: 'x' }],
        }),
      )
      await page.goto('/verify-email?token=old')
      await ready(page, t.auth.verify.alreadyTitle)
      await expect(page.getByRole('link', { name: t.auth.verify.toHome })).toBeVisible()
      await expectNoAxeViolations(page)
    },
  )

  test('недействительная ссылка: скриншот', { tag: '@visual' }, async ({ page }) => {
    await openVerify(page, 'invalid')
    await expect(page).toHaveScreenshot('verify-email-invalid.png')
  })

  test('недействительная ссылка: доступность', { tag: '@a11y' }, async ({ page }) => {
    await openVerify(page, 'invalid')
    await expectNoAxeViolations(page)
  })
})

test.describe('плашка «Подтвердите e-mail»', () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedIn(page, meFixture({ emailVerified: false }))
  })

  async function openHome(page: Page) {
    await page.goto('/')
    await expect(page.getByText(t.auth.banner.title)).toBeVisible()
    await fontsReady(page)
  }

  test('скриншот', { tag: '@visual' }, async ({ page }) => {
    await openHome(page)
    await expect(page).toHaveScreenshot('verify-banner.png')
  })

  test('доступность', { tag: '@a11y' }, async ({ page }) => {
    await openHome(page)
    await expectNoAxeViolations(page)
    expect(await horizontalOverflow(page)).toBe(0)
  })

  test('«Отправить ещё раз»: успех и лимит', { tag: '@a11y' }, async ({ page }) => {
    let calls = 0
    await page.route(`**${API}/auth/verify-email/resend`, (route) => {
      calls += 1
      return calls === 1
        ? route.fulfill({ status: 204 })
        : problem(route, 429, 'too_many_requests', { retryAfter: 45 })
    })
    await openHome(page)
    const resend = page.getByRole('button', { name: t.auth.banner.resend })
    await resend.click()
    await expect(page.getByText(t.auth.banner.resent(EMAIL))).toBeVisible()
    await resend.click()
    await expect(page.getByText(/Попробуйте через 1\s+минуту/)).toBeVisible()
  })

  test('скрывается до следующего входа', { tag: '@a11y' }, async ({ page }) => {
    await openHome(page)
    await page.getByRole('button', { name: t.auth.banner.hide }).click()
    await expect(page.getByText(t.auth.banner.title)).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: t.nav.home })).toBeVisible()
    await expect(page.getByText(t.auth.banner.title)).toHaveCount(0)
  })

  test('не перекрывает нижнюю панель', { tag: '@a11y' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Нижняя панель есть только на mobile')
    await openHome(page)
    const banner = await page.getByRole('region', { name: t.auth.banner.title }).boundingBox()
    const nav = await page.getByRole('navigation', { name: t.nav.label }).boundingBox()
    expect(banner!.y + banner!.height).toBeLessThanOrEqual(nav!.y)
  })
})

test.describe('документы', () => {
  test.beforeEach(async ({ page }) => {
    await mockSignedOut(page)
  })

  test('соглашение: скриншот', { tag: '@visual' }, async ({ page }) => {
    await page.goto('/legal/terms')
    await ready(page, t.legal.terms.title)
    await expect(page).toHaveScreenshot('legal-terms.png')
  })

  for (const doc of ['terms', 'privacy'] as const) {
    test(`${doc}: доступность без входа`, { tag: '@a11y' }, async ({ page }) => {
      await page.goto(`/legal/${doc}`)
      await ready(page, t.legal[doc].title)
      // Публичная страница: без входа не уводит на экран входа.
      await expect(page).toHaveURL(new RegExp(`/legal/${doc}$`))
      await expectNoAxeViolations(page)
    })
  }
})

test.describe('шрифт 200 %: нет горизонтального скролла', () => {
  /** Экран и как его открыть (с подменой нужных ответов API). */
  const screens: { name: string; open: (page: Page) => Promise<void> }[] = [
    { name: 'вход', open: (page) => openLogin(page) },
    { name: 'регистрация', open: (page) => openRegister(page) },
    {
      name: 'восстановление пароля',
      open: async (page) => {
        await page.goto('/forgot-password')
        await ready(page, t.auth.forgot.title)
      },
    },
    {
      name: 'письмо отправлено',
      open: async (page) => {
        await page.route(`**${API}/auth/password-reset`, (route) => route.fulfill({ status: 202 }))
        await page.goto('/forgot-password')
        await emailField(page).fill('very.long.address.for.layout.check@example.com')
        await page.getByRole('button', { name: t.auth.forgot.submit }).click()
        await ready(page, t.auth.forgot.sentTitle)
      },
    },
    {
      name: 'новый пароль',
      open: async (page) => {
        await page.goto('/reset-password?token=abc')
        await ready(page, t.auth.reset.title)
      },
    },
    {
      name: 'ссылка сброса недействительна',
      open: async (page) => {
        await page.goto('/reset-password')
        await ready(page, t.auth.reset.invalidTitle)
      },
    },
    {
      name: 'e-mail подтверждён',
      open: async (page) => {
        await page.route(`**${API}/auth/verify-email`, (route) => route.fulfill({ status: 204 }))
        await page.goto('/verify-email?token=abc')
        await ready(page, t.auth.verify.successTitle)
      },
    },
    {
      name: 'ссылка подтверждения недействительна',
      open: async (page) => {
        await page.goto('/verify-email')
        await ready(page, t.auth.verify.invalidTitle)
      },
    },
    {
      name: 'соглашение',
      open: async (page) => {
        await page.goto('/legal/terms')
        await ready(page, t.legal.terms.title)
      },
    },
    {
      name: 'политика ПДн',
      open: async (page) => {
        await page.goto('/legal/privacy')
        await ready(page, t.legal.privacy.title)
      },
    },
    {
      name: 'плашка «Подтвердите e-mail»',
      open: async (page) => {
        await page.unrouteAll()
        await mockSignedIn(
          page,
          meFixture({ emailVerified: false, email: 'very.long.address.for.layout@example.com' }),
        )
        await page.goto('/')
        await expect(page.getByText(t.auth.banner.title)).toBeVisible()
      },
    },
  ]

  test.beforeEach(async ({ page }) => {
    await mockSignedOut(page)
  })

  for (const screen of screens) {
    test(screen.name, { tag: '@a11y' }, async ({ page }) => {
      await screen.open(page)
      await enlargeFont(page)
      expect(await horizontalOverflow(page)).toBe(0)
    })
  }

  test('скриншот: восстановление пароля', { tag: '@visual' }, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Крупный шрифт важен на узком экране')
    await page.goto('/forgot-password')
    await ready(page, t.auth.forgot.title)
    await enlargeFont(page)
    await expect(page).toHaveScreenshot('forgot-password-font-200.png', { fullPage: true })
  })
})

test.describe('сессия кончилась при открытом быстром вводе', () => {
  async function expire(page: Page) {
    // Часы — свои: «прошло 31 с», и /me устарел (staleTime 30 с).
    await page.clock.install()
    await mockSignedIn(page)
    await page.goto('/accounts')
    await expect(page.getByRole('heading', { level: 1, name: t.nav.accounts })).toBeVisible()
    await page
      .getByRole('navigation', { name: t.nav.label })
      .getByRole('button', { name: t.nav.addTransaction })
      .click()
    await expect(page.getByRole('dialog', { name: t.quickAdd.title })).toBeVisible()

    await mockSignedOut(page)
    await page.clock.fastForward(31_000)
    // Возврат во вкладку: TanStack Query перезапрашивает устаревший /me и получает 401.
    await page.evaluate(() =>
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true })),
    )
    await expect(page).toHaveURL(/\/login\?next=%2Faccounts$/)
    await ready(page, t.auth.login.title)
  }

  test('окно закрывается вместе с оболочкой', { tag: '@a11y' }, async ({ page }) => {
    await expire(page)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(passwordField(page)).toBeVisible()
    await expectNoAxeViolations(page)
  })

  test('скриншот экрана входа после 401', { tag: '@visual' }, async ({ page }) => {
    await expire(page)
    await expect(page).toHaveScreenshot('quick-add-session-expired.png')
  })
})
