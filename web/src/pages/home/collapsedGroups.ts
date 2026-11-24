import { useCallback, useState } from 'react'

// Свёрнутые группы счетов на главной («Общие», «Личные»). Помнятся в localStorage — удобство
// одного браузера, не настройка профиля. Хранилище может быть недоступно (приватный режим,
// запрет cookie) — тогда всё работает, просто не запоминается.

export type AccountGroupKey = 'shared' | 'private'
export type CollapsedGroups = Record<AccountGroupKey, boolean>

export const COLLAPSED_GROUPS_KEY = 'pa:home:collapsedAccountGroups'

const NONE: CollapsedGroups = { shared: false, private: false }

/** Разобрать сохранённое значение; мусор и чужой формат — «ничего не свёрнуто». */
export function parseCollapsedGroups(raw: string | null): CollapsedGroups {
  if (!raw) return NONE
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return NONE
    const record = value as Record<string, unknown>
    return { shared: record.shared === true, private: record.private === true }
  } catch {
    return NONE
  }
}

function read(): CollapsedGroups {
  try {
    return parseCollapsedGroups(window.localStorage.getItem(COLLAPSED_GROUPS_KEY))
  } catch {
    return NONE
  }
}

function write(value: CollapsedGroups) {
  try {
    window.localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(value))
  } catch {
    // Не запомнили — не страшно: в этом сеансе состояние держит React.
  }
}

/** Какие группы свёрнуты и переключатель; состояние читается из хранилища один раз. */
export function useCollapsedGroups(): [CollapsedGroups, (group: AccountGroupKey) => void] {
  const [collapsed, setCollapsed] = useState(read)
  const toggle = useCallback((group: AccountGroupKey) => {
    setCollapsed((prev) => {
      const next = { ...prev, [group]: !prev[group] }
      write(next)
      return next
    })
  }, [])
  return [collapsed, toggle]
}
