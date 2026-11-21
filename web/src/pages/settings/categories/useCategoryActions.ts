import { notifications } from '@mantine/notifications'
import { useQueryClient, type Mutation } from '@tanstack/react-query'

import {
  getListCategoriesQueryKey,
  useArchiveCategory,
  useCreateCategory,
  useMergeCategory,
  useMoveCategory,
  useUnarchiveCategory,
  useUpdateCategory,
  type Category,
  type CategoryKind,
  type CategoryList,
} from '../../../shared/api'
import { useT } from '../../../shared/i18n'
import {
  applyArchive,
  applyMove,
  applyUnarchive,
  categoryLabel,
  currentMoveIndex,
} from '../../../shared/lib/categoryTree'
import { notifyWithUndo } from '../../../shared/ui'
import { categoryActionErrorText } from './categoryErrors'

/**
 * Очередь изменений категорий. Мутации с общим `scope` TanStack Query выполняет строго
 * по одной, в порядке вызова: два быстрых перемещения не уходят параллельно (сервер мог бы
 * применить их в другом порядке), «Отменить» не обгонит действие, которое отменяет.
 */
const SCOPE = { id: 'categories' }

const inScope = (m: Mutation<unknown, unknown, unknown, unknown>) =>
  m.options.scope?.id === SCOPE.id

/**
 * Изменения категорий с экрана «Категории».
 *
 * Перемещение, архив и возврат — оптимистичные (ux.md, принцип 5): список в кэше меняется
 * сразу. Список перезапрашивается, только когда завершилась последняя мутация очереди:
 * ответ на перезапрос посреди очереди затёр бы оптимистичные изменения, которые ещё
 * не дошли до сервера, и строки «прыгали» бы туда-обратно.
 *
 * Ошибка не откатывает кэш к снимку (снимок стёр бы более поздние оптимистичные правки):
 * показываем тост с причиной, а верное состояние приходит перезапросом в конце очереди.
 */
export function useCategoryActions() {
  const t = useT()
  const queryClient = useQueryClient()
  const key = getListCategoriesQueryKey()

  const mutation = {
    scope: SCOPE,
    // Вызывается, пока сама мутация ещё в счёте `isMutating`: 1 — она последняя в очереди.
    onSettled: () => {
      if (queryClient.isMutating({ predicate: inScope }) <= 1) {
        return queryClient.invalidateQueries({ queryKey: key })
      }
    },
  }
  const moveMutation = useMoveCategory({ mutation })
  const archiveMutation = useArchiveCategory({ mutation })
  const unarchiveMutation = useUnarchiveCategory({ mutation })
  const createMutation = useCreateCategory({ mutation })
  const updateMutation = useUpdateCategory({ mutation })
  const mergeMutation = useMergeCategory({ mutation })

  const items = () => queryClient.getQueryData<CategoryList>(key)?.items ?? []

  /** Изменить кэш сразу; ответ уже идущего запроса списка затёр бы изменение — отменяем его. */
  const applyNow = (change: (list: Category[]) => Category[]) => {
    void queryClient.cancelQueries({ queryKey: key })
    queryClient.setQueryData<CategoryList>(key, (old) => old && { items: change(old.items) })
  }

  /** Отправить запрос; ошибка — тост с причиной (тост действия с «Отменить» закрываем). */
  const send = (request: () => Promise<unknown>, undoToastId?: string) => {
    request().catch((error: unknown) => {
      if (undoToastId) notifications.hide(undoToastId)
      notifications.show({ color: 'red', message: categoryActionErrorText(error, t) })
    })
  }

  /**
   * Переместить: `index` — позиция для API (среди всех соседей, с архивными).
   * `undoable: false` — это само «Отменить», второго тоста не нужно.
   */
  const move = (id: string, parentId: string | null, index: number, undoable = true) => {
    const list = items()
    const category = list.find((c) => c.id === id)
    if (!category) return
    // Прежнее место — для отмены; считается до изменения.
    const back = { parentId: category.parentId, index: currentMoveIndex(list, id) }
    applyNow((l) => applyMove(l, id, parentId, index))
    const undoToastId = undoable
      ? notifyWithUndo({
          message: t.categories.moved(category.name),
          onUndo: () => move(id, back.parentId, back.index, false),
        })
      : undefined
    send(() => moveMutation.mutateAsync({ categoryId: id, data: { parentId, index } }), undoToastId)
  }

  const unarchive = (id: string) => {
    applyNow((l) => applyUnarchive(l, id))
    send(() => unarchiveMutation.mutateAsync({ categoryId: id }))
  }

  const archive = (category: Category) => {
    applyNow((l) => applyArchive(l, category.id, new Date().toISOString()))
    const undoToastId = notifyWithUndo({
      message: t.categories.archived(category.name),
      onUndo: () => unarchive(category.id),
    })
    send(() => archiveMutation.mutateAsync({ categoryId: category.id }), undoToastId)
  }

  /** Создать; ошибка пробрасывается в форму (она показывает её у поля). */
  const create = async (kind: CategoryKind, parentId: string | null, name: string) => {
    const created = await createMutation.mutateAsync({ data: { kind, parentId, name } })
    queryClient.setQueryData<CategoryList>(key, (old) => old && { items: [...old.items, created] })
  }

  const rename = async (id: string, name: string) => {
    const updated = await updateMutation.mutateAsync({ categoryId: id, data: { name } })
    queryClient.setQueryData<CategoryList>(
      key,
      (old) => old && { items: old.items.map((c) => (c.id === id ? updated : c)) },
    )
  }

  const merge = async (category: Category, targetId: string) => {
    const list = items()
    const target = list.find((c) => c.id === targetId)
    const targetLabel = target
      ? categoryLabel(
          target,
          list.find((c) => c.id === target.parentId),
        )
      : ''
    await mergeMutation.mutateAsync({ categoryId: category.id, data: { targetId } })
    queryClient.setQueryData<CategoryList>(
      key,
      (old) =>
        old && {
          items: old.items.filter((c) => c.id !== category.id && c.parentId !== category.id),
        },
    )
    notifications.show({ message: t.categories.merge.done(category.name, targetLabel) })
  }

  return { move, archive, unarchive, create, rename, merge }
}
