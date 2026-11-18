import { describe, expect, it } from 'vitest'

import { formatCount, plural, type PluralForms } from './plural'

const operations: PluralForms = { one: 'операция', few: 'операции', many: 'операций' }

describe('plural', () => {
  it.each([
    [1, 'операция'],
    [2, 'операции'],
    [4, 'операции'],
    [5, 'операций'],
    [11, 'операций'],
    [12, 'операций'],
    [14, 'операций'],
    [21, 'операция'],
    [22, 'операции'],
    [25, 'операций'],
    [101, 'операция'],
    [111, 'операций'],
    [0, 'операций'],
  ])('%i → %s', (count, expected) => {
    expect(plural(count, operations)).toBe(expected)
  })

  it('для дробных берёт other, а без неё — few', () => {
    expect(plural(1.5, operations)).toBe('операции')
    expect(plural(1.5, { ...operations, other: 'операции*' })).toBe('операции*')
  })
})

describe('formatCount', () => {
  it('ставит число с разделителем разрядов и неразрывным пробелом', () => {
    expect(formatCount(21, operations)).toBe('21 операция')
    expect(formatCount(1500, operations).replace(/[  ]/g, ' ')).toBe('1 500 операций')
  })
})
