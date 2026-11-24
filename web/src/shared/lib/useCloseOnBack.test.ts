import { describe, expect, it } from 'vitest'

import { sheetsOf, withSheets } from './useCloseOnBack'

describe('метки окон в history.state', () => {
  it('state роутера сохраняется, метки добавляются', () => {
    const router = { usr: null, key: 'abc', idx: 3 }
    expect(withSheets(router, ['a'])).toEqual({ usr: null, key: 'abc', idx: 3, __sheets: ['a'] })
    expect(sheetsOf(withSheets(router, ['a', 'b']))).toEqual(['a', 'b'])
  })

  it('нет state или меток — пустой список', () => {
    expect(sheetsOf(null)).toEqual([])
    expect(sheetsOf({ usr: null, key: 'x', idx: 0 })).toEqual([])
    expect(sheetsOf({ __sheets: 'мусор' })).toEqual([])
    expect(withSheets(null, ['a'])).toEqual({ __sheets: ['a'] })
  })
})
