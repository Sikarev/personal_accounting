import { QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient, getGetMeQueryKey, type Me } from '../../shared/api'
import { browserTimezone, timezoneOf, useTimezone, useToday } from './session'

const me = (timezone: string): Me => ({
  user: {
    id: 'u1',
    email: 'anna@example.com',
    name: 'Анна',
    timezone,
    emailVerified: true,
  },
  family: { id: 'f1', name: 'Семья', role: 'owner' },
})

/**
 * Отрисовать хук без DOM: renderToString выполняет рендер синхронно,
 * а данные `/me` уже лежат в кэше — запроса не будет.
 */
function renderHook(hook: () => string, data?: Me): string {
  const client = createQueryClient()
  if (data) client.setQueryData(getGetMeQueryKey(), data)
  let result = ''
  const Probe = () => {
    result = hook()
    return null
  }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)))
  return result
}

afterEach(() => {
  vi.useRealTimers()
})

describe('timezoneOf', () => {
  it('пояс из профиля', () => {
    expect(timezoneOf(me('Asia/Vladivostok'))).toBe('Asia/Vladivostok')
  })

  it('без профиля — пояс браузера', () => {
    expect(timezoneOf(undefined)).toBe(browserTimezone())
  })
})

describe('useTimezone', () => {
  it('берёт пояс из /me в кэше', () => {
    expect(renderHook(useTimezone, me('Asia/Vladivostok'))).toBe('Asia/Vladivostok')
  })

  it('пока /me нет — пояс браузера', () => {
    expect(renderHook(useTimezone)).toBe(browserTimezone())
  })
})

describe('useToday', () => {
  it('«сегодня» считается в поясе профиля, а не браузера', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 21 ноября, 20:30 UTC: во Владивостоке (UTC+10) уже 22-е, в Лондоне ещё 21-е.
    vi.setSystemTime(new Date('2026-11-21T20:30:00Z'))
    expect(renderHook(useToday, me('Asia/Vladivostok'))).toBe('2026-11-22')
    expect(renderHook(useToday, me('Europe/London'))).toBe('2026-11-21')
  })
})
