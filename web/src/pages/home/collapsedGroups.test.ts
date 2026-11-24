import { describe, expect, it } from 'vitest'

import { parseCollapsedGroups } from './collapsedGroups'

describe('parseCollapsedGroups', () => {
  it('сохранённое значение', () => {
    expect(parseCollapsedGroups('{"shared":true,"private":false}')).toEqual({
      shared: true,
      private: false,
    })
  })

  it('ничего не сохранено, мусор или чужой формат — ничего не свёрнуто', () => {
    const none = { shared: false, private: false }
    expect(parseCollapsedGroups(null)).toEqual(none)
    expect(parseCollapsedGroups('не json')).toEqual(none)
    expect(parseCollapsedGroups('null')).toEqual(none)
    expect(parseCollapsedGroups('{"shared":"yes"}')).toEqual(none)
  })
})
