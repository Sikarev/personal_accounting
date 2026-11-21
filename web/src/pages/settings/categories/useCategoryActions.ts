import { notifications } from '@mantine/notifications'
import { useQueryClient } from '@tanstack/react-query'

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
 * Изменения категорий с экрана «Категории».
 *
 * Перемещение, архив и возврат — оптимистичные (ux.md, принцип 5): список в кэше меняется
 * сразу, при ошибке возвращается прежний и показывается тост с причиной. После любого
 * ответа список перезапрашивается — источник правды остаётся на сервере (перенумерация
 * соседей, каскад архива).
 *
 * Отмена в тосте отправляет обратное действие только после ответа на исходное: иначе
 * «вернуть» могло бы дойти до сервера раньше «архивировать», и категория осталась бы в архиве.
 */
export function useCategoryActions() {
  const t = useT()
  const queryClient = useQueryClient()
  const key = getListCategoriesQueryKey()

  const moveMutation = useMoveCategory()
  const archiveMutation = useArchiveCategory()
  const unarchiveMutation = useUnarchiveCategory()
  const createMutation = useCreateCategory()
  const updateMutation = useUpdateCategory()
  const mergeMutation = useMergeCategory()

  const items = () => queryClient.getQueryData<CategoryList>(key)?.items ?? []
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })

  /**
   * Применить изменение к кэшу и отправить запрос (после `after`, если задан).
   * Ошибка: кэш — к снимку до изменения, тост действия (если был) закрыт, показан тост ошибки.
   */
  const optimistic = (
    change: (list: Category[]) => Category[],
    request: () => Promise<unknown>,
    options: { after?: Promise<unknown>; undoToastId?: string } = {},
  ): Promise<unknown> => {
    // Ответ на уже идущий запрос списка затёр бы оптимистичное изменение.
    void queryClient.cancelQueries({ queryKey: key })
    const before = queryClient.getQueryData<CategoryList>(key)
    if (before) queryClient.setQueryData<CategoryList>(key, { items: change(before.items) })

    const run = async () => {
      // Ошибку предыдущего шага уже показали; обратное действие всё равно отправляем.
      await options.after?.catch(() => undefined)
      try {
        await request()
      } catch (error) {
        if (before) queryClient.setQueryData<CategoryList>(key, before)
        if (options.undoToastId) notifications.hide(options.undoToastId)
        notifications.show({ color: 'red', message: categoryActionErrorText(error, t) })
        throw error
      } finally {
        void refresh()
      }
    }
    const done = run()
    // Ошибка уже показана пользователю — не даём ей стать «необработанной» в консоли.
    done.catch(() => undefined)
    return done
  }

  /** Переместить: `index` — позиция для API (среди всех соседей, с архивными). */
  const move = (id: string, parentId: string | null, index: number, after?: Promise<unknown>) => {
    const list = items()
    const category = list.find((c) => c.id === id)
    if (!category) return
    // Прежнее место — для отмены; считается до изменения.
    const back = { parentId: category.parentId, index: currentMoveIndex(list, id) }
    const request = () => moveMutation.mutateAsync({ categoryId: id, data: { parentId, index } })

    if (after) {
      optimistic((l) => applyMove(l, id, parentId, index), request, { after })
      return
    }
    let done: Promise<unknown> = Promise.resolve()
    const undoToastId = notifyWithUndo({
      message: t.categories.moved(category.name),
      onUndo: () => move(id, back.parentId, back.index, done),
    })
    done = optimistic((l) => applyMove(l, id, parentId, index), request, { undoToastId })
  }

  const unarchive = (id: string, after?: Promise<unknown>) =>
    optimistic(
      (l) => applyUnarchive(l, id),
      () => unarchiveMutation.mutateAsync({ categoryId: id }),
      { after },
    )

  const archive = (category: Category) => {
    let done: Promise<unknown> = Promise.resolve()
    const undoToastId = notifyWithUndo({
      message: t.categories.archived(category.name),
      onUndo: () => void unarchive(category.id, done),
    })
    done = optimistic(
      (l) => applyArchive(l, category.id, new Date().toISOString()),
      () => archiveMutation.mutateAsync({ categoryId: category.id }),
      { undoToastId },
    )
  }

  /** Создать; ошибка пробрасывается в форму (она показывает её у поля). */
  const create = async (kind: CategoryKind, parentId: string | null, name: string) => {
    const created = await createMutation.mutateAsync({ data: { kind, parentId, name } })
    queryClient.setQueryData<CategoryList>(key, (old) => old && { items: [...old.items, created] })
    void refresh()
  }

  const rename = async (id: string, name: string) => {
    const updated = await updateMutation.mutateAsync({ categoryId: id, data: { name } })
    queryClient.setQueryData<CategoryList>(
      key,
      (old) => old && { items: old.items.map((c) => (c.id === id ? updated : c)) },
    )
    void refresh()
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
    void refresh()
    notifications.show({ message: t.categories.merge.done(category.name, targetLabel) })
  }

  return { move, archive, unarchive, create, rename, merge }
}
