import { useNavigate } from 'react-router'

import { paths } from '../../app/navigation'
import type { Transaction } from '../../shared/api'
import { TransactionForm } from '../transactions/TransactionForm'

/**
 * Содержимое окна быстрого ввода. Отдельный модуль — грузится лениво (техдолг №37):
 * форма с пикерами (`Select`, чипы) не входит в первую загрузку. См. `QuickAddProvider`.
 */
export function QuickAddContent({
  onClose,
  template,
}: {
  onClose: () => void
  /** Создать по образцу (дублирование из ленты). */
  template?: Transaction | null
}) {
  const navigate = useNavigate()
  return (
    <TransactionForm
      autoFocus
      template={template}
      onCreateAccount={() => {
        // replace: запись окна в истории (useCloseOnBack) заменяется экраном «Счета» —
        // «Назад» оттуда ведёт на прежний экран, а не на «пустой» шаг с закрытым окном.
        void navigate(paths.accounts, { replace: true })
        onClose()
      }}
    />
  )
}
