import { useNavigate } from 'react-router'

import { paths } from '../../app/navigation'
import { TransactionForm } from '../transactions/TransactionForm'

/**
 * Содержимое окна быстрого ввода. Отдельный модуль — грузится лениво (техдолг №37):
 * форма с пикерами (`Select`, чипы) не входит в первую загрузку. См. `QuickAddProvider`.
 */
export function QuickAddContent({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  return (
    <TransactionForm
      autoFocus
      onCreateAccount={() => {
        // replace: запись окна в истории (useCloseOnBack) заменяется экраном «Счета» —
        // «Назад» оттуда ведёт на прежний экран, а не на «пустой» шаг с закрытым окном.
        void navigate(paths.accounts, { replace: true })
        onClose()
      }}
    />
  )
}
