import { lazy, Suspense } from 'react'

import type { Transaction } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { ResponsiveSheet } from '../../shared/ui'
import { useQuickAdd } from '../quick-add/quickAddContext'
import { ChunkLoadBoundary } from './ChunkLoadBoundary'
import { TransactionFormSkeleton } from './TransactionFormSkeleton'
import type { EditSheetState } from './useEditSheet'

// Форма правки тянет общую форму операции с пикерами — отдельным чанком (тем же, что
// у быстрого ввода): главная грузится сразу, и форма не должна попасть в первую загрузку.
const EditTransaction = lazy(() =>
  import('./EditTransaction').then((m) => ({ default: m.EditTransaction })),
)

type EditTransactionSheetProps = {
  sheet: EditSheetState
  /** Открытая операция — из текущего списка экрана (`sheet.editingId`); пропала — окно пустое. */
  transaction: Transaction | undefined
  /** Подпись операции («Продукты › Молочное») — для имени области правки. */
  title: string
  /** Сервер сохранил правку: строка в списках и тост (`useTransactionActions().edited`). */
  onEdited: (saved: Transaction) => void
  /** «Удалить»: строка уходит — фокус ставит экран (окно его не возвращает). */
  onDelete: (transaction: Transaction) => void
}

/**
 * Окно правки операции (`ResponsiveSheet`: на телефоне — снизу, на desktop — модалка)
 * с общей формой и действиями «Дублировать» и «Удалить». Общее для ленты (на mobile)
 * и последних операций на главной.
 *
 * «Дублировать» открывает быстрый ввод с образцом — после того как окно правки закрылось
 * и ушло из истории «Назад»: открытое раньше, оно встало бы поверх уходящей записи.
 */
export function EditTransactionSheet({
  sheet,
  transaction,
  title,
  onEdited,
  onDelete,
}: EditTransactionSheetProps) {
  const t = useT()
  const quickAdd = useQuickAdd()
  return (
    <ResponsiveSheet
      opened={sheet.opened}
      onClose={sheet.close}
      title={t.feed.edit.title}
      fullHeight
      returnFocus={sheet.returnFocus}
      onExitTransitionEnd={sheet.exited}
      onHistoryReleased={sheet.historyReleased}
    >
      {transaction && (
        <ChunkLoadBoundary>
          <Suspense fallback={<TransactionFormSkeleton />}>
            <EditTransaction
              transaction={transaction}
              title={title}
              onSaved={(saved) => {
                onEdited(saved)
                sheet.close()
              }}
              onClose={sheet.close}
              onAction={(action, target) => {
                if (action === 'delete') {
                  sheet.closeForRemoval()
                  onDelete(target)
                } else {
                  sheet.closeThen(() => quickAdd.open(target))
                }
              }}
            />
          </Suspense>
        </ChunkLoadBoundary>
      )}
    </ResponsiveSheet>
  )
}
