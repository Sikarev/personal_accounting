import { describe, expect, it } from 'vitest'

import { isPublicPath, loginPath } from './navigation'

describe('isPublicPath', () => {
  it.each([
    '/login',
    '/login/',
    '/LOGIN',
    '/Register',
    '/forgot-password',
    '/reset-password/',
    '/verify-email',
    '/verify-email/',
    '/legal/terms',
    '/legal/terms/',
    '/legal/privacy',
  ])('%s — публичная', (pathname) => {
    expect(isPublicPath(pathname)).toBe(true)
  })

  it.each(['/', '/accounts', '/more', '/login/extra', '/legal', '/legal/other', '/verify-emails'])(
    '%s — только после входа',
    (pathname) => {
      expect(isPublicPath(pathname)).toBe(false)
    },
  )
})

describe('loginPath', () => {
  it('без next для главной', () => {
    expect(loginPath('/')).toBe('/login')
    expect(loginPath()).toBe('/login')
  })

  it('кодирует путь с параметрами', () => {
    expect(loginPath('/accounts?tab=1')).toBe('/login?next=%2Faccounts%3Ftab%3D1')
  })
})
