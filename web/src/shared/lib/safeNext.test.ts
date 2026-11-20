import { describe, expect, it } from 'vitest'

import { safeNextPath } from './safeNext'

describe('safeNextPath', () => {
  it.each([
    ['/', '/'],
    ['/accounts', '/accounts'],
    ['/transactions?account=1&from=2026-11-01', '/transactions?account=1&from=2026-11-01'],
    ['/reports#month', '/reports#month'],
    // Закодированная косая черта внутри пути — это часть пути, а не адрес сайта.
    ['/%2F%2Fevil.com', '/%2F%2Fevil.com'],
    ['/a//b', '/a//b'],
  ])('принимает путь приложения %s', (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected)
  })

  it.each([
    ['пусто', ''],
    ['null', null],
    ['undefined', undefined],
    ['адрес другого сайта без схемы', '//evil.com'],
    ['обратная косая черта', '/\\evil.com'],
    ['обратная косая черта дважды', '\\\\evil.com'],
    ['обратная косая черта внутри', '/a\\b'],
    ['три косые черты', '///evil.com'],
    ['https', 'https://evil.com'],
    ['http с путём', 'http://evil.com/accounts'],
    ['javascript:', 'javascript:alert(1)'],
    ['javascript: в верхнем регистре', 'JaVaScRiPt:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['относительный путь', 'accounts'],
    ['домен без схемы', 'evil.com'],
    ['закодированный //', '%2F%2Fevil.com'],
    ['закодированный /\\', '%2F%5Cevil.com'],
    ['табуляция между косыми', '/\t/evil.com'],
    ['перевод строки между косыми', '/\n/evil.com'],
    ['пробел в начале', ' /accounts'],
    ['управляющий символ', '/\u0000/evil.com'],
  ])('отклоняет: %s', (_, raw) => {
    expect(safeNextPath(raw)).toBe('/')
  })

  it('закодированный адрес после одного декодирования тоже отклоняется', () => {
    // URLSearchParams декодирует значение один раз: ?next=%2F%2Fevil.com → //evil.com.
    const next = new URLSearchParams('next=%2F%2Fevil.com').get('next')
    expect(next).toBe('//evil.com')
    expect(safeNextPath(next)).toBe('/')
    expect(safeNextPath(new URLSearchParams('next=%2F%5Cevil.com').get('next'))).toBe('/')
    expect(safeNextPath(new URLSearchParams('next=%2F%09%2Fevil.com').get('next'))).toBe('/')
  })

  it('возвращает заданный запасной адрес', () => {
    expect(safeNextPath('//evil.com', '/more')).toBe('/more')
  })
})
