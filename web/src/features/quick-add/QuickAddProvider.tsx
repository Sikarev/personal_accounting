import { useDisclosure } from '@mantine/hooks'
import { IconBolt } from '@tabler/icons-react'
import { useMemo, type ReactNode } from 'react'

import { useT } from '../../shared/i18n'
import { EmptyState, ResponsiveSheet } from '../../shared/ui'
import { QuickAddContext, type QuickAddApi } from './quickAddContext'

/**
 * Держит состояние окна быстрого ввода. Окно одно на приложение,
 * открыть его можно откуда угодно через `useQuickAdd().open()`.
 */
export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [opened, { open, close }] = useDisclosure(false)
  const api = useMemo<QuickAddApi>(() => ({ open }), [open])
  const t = useT()

  return (
    <QuickAddContext.Provider value={api}>
      {children}
      {/* fullHeight: на телефоне быстрый ввод — на всю высоту, клавиатура сразу (ux.md, §3). */}
      <ResponsiveSheet opened={opened} onClose={close} title={t.quickAdd.title} fullHeight>
        {/* Заглушка до этапа 3 (roadmap): там появится форма с суммой и чипами категорий. */}
        <EmptyState
          icon={IconBolt}
          titleOrder={3}
          title={t.quickAdd.stubTitle}
          description={t.quickAdd.stubDescription}
        />
      </ResponsiveSheet>
    </QuickAddContext.Provider>
  )
}
