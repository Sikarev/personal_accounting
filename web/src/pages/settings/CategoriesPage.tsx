import { Box, Button, Paper, Tabs } from '@mantine/core'
import { IconAlertCircle, IconCategory, IconPlus } from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'

import { paths } from '../../app/navigation'
import { apiErrorText, useListCategories, type Category, type CategoryKind } from '../../shared/api'
import { useT } from '../../shared/i18n'
import {
  activeTree,
  applyUnarchive,
  archivedEntries,
  childrenOf,
  toMoveIndex,
} from '../../shared/lib/categoryTree'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import { useMobileLayout } from '../../shared/lib/useMobileLayout'
import { EmptyState, PageHeader, ResponsiveSheet } from '../../shared/ui'
import { icons } from '../../theme'
import { ArchiveSection } from './categories/ArchiveSection'
import { CategoryNameForm } from './categories/CategoryNameForm'
import { CategoryTree, type CategoryAction } from './categories/CategoryTree'
import {
  addCategorySelector,
  archiveToggleSelector,
  restoreSelector,
  rowMenuSelector,
} from './categories/focusTargets'
import { CategoryTreeSkeleton } from './categories/CategoryTreeSkeleton'
import { MergeCategoryForm } from './categories/MergeCategoryForm'
import { MoveCategoryForm } from './categories/MoveCategoryForm'
import { flattenTree } from './categories/treeProjection'
import { useCategoryActions } from './categories/useCategoryActions'

const KINDS: CategoryKind[] = ['expense', 'income']

/** Вид категорий — в адресе (`?kind=income`): ссылка и «Назад» открывают ту же вкладку. */
function kindFromParams(params: URLSearchParams): CategoryKind {
  return params.get('kind') === 'income' ? 'income' : 'expense'
}

/**
 * Куда перевести фокус, когда строки `removed` исчезают из дерева (архив, слияние): на меню
 * следующей строки, иначе предыдущей, иначе на «Добавить категорию» — а не в никуда (BODY).
 */
function neighbourSelectors(
  categories: readonly Category[],
  kind: CategoryKind,
  id: string,
  removed: ReadonlySet<string>,
): string[] {
  const flat = flattenTree(activeTree(categories, kind))
  const at = flat.findIndex((i) => i.id === id)
  const next = flat.slice(at + 1).find((i) => !removed.has(i.id))
  const prev = flat
    .slice(0, Math.max(at, 0))
    .reverse()
    .find((i) => !removed.has(i.id))
  return [next, prev].flatMap((i) => (i ? [rowMenuSelector(i.id)] : [])).concat(addCategorySelector)
}

/** Строки, уходящие вместе с категорией: она и её подкатегории. */
function withChildren(categories: readonly Category[], id: string): Set<string> {
  return new Set([id, ...childrenOf(categories, id).map((c) => c.id)])
}

type Dialog =
  | { type: 'create'; kind: CategoryKind; parent: Category | null }
  | { type: 'rename'; category: Category }
  | { type: 'move'; category: Category }
  | { type: 'merge'; category: Category }

/**
 * «Настройки → Категории»: два дерева (расходы и доходы) — создание, переименование,
 * перетаскивание, «Переместить в…», архив с отменой, удаление слиянием.
 */
export function CategoriesPage() {
  const t = useT()
  const mobile = useMobileLayout()
  const [params, setParams] = useSearchParams()
  const kind = kindFromParams(params)

  const query = useListCategories()
  const showSkeleton = useDelayedLoading(query.isPending)
  const actions = useCategoryActions()

  // Данные окна живут дольше, чем `opened`: окно доигрывает анимацию закрытия с содержимым.
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [opened, setOpened] = useState(false)
  // Новый ключ на каждое открытие — форма начинается с чистого состояния.
  const [dialogKey, setDialogKey] = useState(0)
  // Действие в окне убрало строку, открывшую окно (слияние): фокус ставим сами после
  // закрытия — как на экране «Счета» (`returnFocus` + `onExitTransitionEnd`).
  const [returnFocus, setReturnFocus] = useState(true)
  const afterClose = useRef<(() => void) | null>(null)
  const open = (next: Dialog) => {
    setDialog(next)
    setReturnFocus(true)
    setDialogKey((k) => k + 1)
    setOpened(true)
  }
  const close = () => setOpened(false)

  const categories = useMemo(() => query.data?.items ?? [], [query.data])

  // Фокус после действий, убирающих или переставляющих строку: первый существующий элемент
  // из списка селекторов, после перерисовки (и после того, как меню Mantine закрылось).
  const [focusRequest, setFocusRequest] = useState<{ selectors: string[] } | null>(null)
  useEffect(() => {
    if (!focusRequest) return
    const frame = requestAnimationFrame(() => {
      for (const selector of focusRequest.selectors) {
        const el = document.querySelector<HTMLElement>(selector)
        if (el) return el.focus()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest])
  const focusFirst = (selectors: string[]) => setFocusRequest({ selectors })
  const hasCategories = useMemo(() => activeTree(categories, kind).length > 0, [categories, kind])

  const handleAction = (action: CategoryAction, category: Category) => {
    switch (action) {
      case 'rename':
        return open({ type: 'rename', category })
      case 'addSub':
        return open({ type: 'create', kind: category.kind, parent: category })
      case 'move':
        return open({ type: 'move', category })
      case 'merge':
        return open({ type: 'merge', category })
      case 'archive':
        focusFirst(
          neighbourSelectors(
            categories,
            category.kind,
            category.id,
            withChildren(categories, category.id),
          ),
        )
        return actions.archive(category)
      case 'up':
      case 'down': {
        // Порядок без перетаскивания (WCAG 2.5.7): на одно место среди видимых соседей.
        const siblings = flattenTree(activeTree(categories, category.kind)).filter(
          (i) => i.parentId === category.parentId,
        )
        const at = siblings.findIndex((i) => i.id === category.id)
        const visibleIndex = action === 'up' ? at - 1 : at + 1
        actions.move(
          category.id,
          category.parentId,
          toMoveIndex(categories, category.id, category.parentId, visibleIndex),
        )
        // Строка переехала — фокус остаётся на её кнопке меню.
        return focusFirst([rowMenuSelector(category.id)])
      }
    }
  }

  const restore = (id: string) => {
    // Фокус — на соседнюю «Вернуть» (вернувшиеся строки уходят из архива), иначе на
    // заголовок архива, иначе на меню вернувшейся категории.
    const entries = archivedEntries(categories, kind).map((e) => e.category.id)
    const restored = new Set(
      applyUnarchive(categories, id)
        .filter((c) => c.archivedAt === null)
        .map((c) => c.id),
    )
    const at = entries.indexOf(id)
    const next = entries.slice(at + 1).find((e) => !restored.has(e))
    const prev = entries
      .slice(0, Math.max(at, 0))
      .reverse()
      .find((e) => !restored.has(e))
    focusFirst([
      ...[next, prev].flatMap((e) => (e ? [restoreSelector(e)] : [])),
      ...(entries.some((e) => !restored.has(e)) ? [archiveToggleSelector] : []),
      rowMenuSelector(id),
    ])
    actions.unarchive(id)
  }

  const addButton = (fullWidth: boolean) => (
    <Button
      size="md"
      variant={fullWidth ? 'light' : 'filled'}
      fullWidth={fullWidth}
      leftSection={<IconPlus size={icons.size.md} stroke={icons.stroke} />}
      onClick={() => open({ type: 'create', kind, parent: null })}
      data-add-category
    >
      {t.categories.add}
    </Button>
  )

  return (
    <>
      <PageHeader
        title={t.categories.title}
        back={mobile ? { to: paths.settings, label: t.settings.back } : undefined}
        // В пустой вкладке главное действие — в пустом состоянии, второе такое же не нужно.
        actions={!mobile && hasCategories ? addButton(false) : undefined}
      />

      <Tabs
        value={kind}
        onChange={(value) =>
          // replace: переключение вкладок не копит записи в истории — «Назад» уводит
          // с экрана, а не листает вкладки.
          setParams(value === 'income' ? { kind: 'income' } : {}, { replace: true })
        }
      >
        <Tabs.List grow={mobile} aria-label={t.categories.tabsLabel} mb="md">
          {KINDS.map((k) => (
            <Tabs.Tab key={k} value={k}>
              {t.categories.kinds[k]}
            </Tabs.Tab>
          ))}
        </Tabs.List>

        {KINDS.map((k) => (
          <Tabs.Panel key={k} value={k}>
            {k === kind &&
              (query.isPending ? (
                showSkeleton && <CategoryTreeSkeleton />
              ) : query.isError ? (
                <Paper withBorder radius="lg">
                  <EmptyState
                    icon={IconAlertCircle}
                    title={t.categories.errorTitle}
                    description={apiErrorText(query.error, t)}
                    action={
                      <Button
                        variant="light"
                        loading={query.isFetching}
                        onClick={() => void query.refetch()}
                      >
                        {t.errors.retry}
                      </Button>
                    }
                  />
                </Paper>
              ) : (
                <KindPanel
                  kind={k}
                  categories={categories}
                  mobile={mobile}
                  addButton={addButton(true)}
                  onAction={handleAction}
                  onAdd={() => open({ type: 'create', kind: k, parent: null })}
                  onRestore={restore}
                  onMove={actions.move}
                />
              ))}
          </Tabs.Panel>
        ))}
      </Tabs>

      <ResponsiveSheet
        opened={opened}
        onClose={close}
        title={dialog && dialogTitle(dialog, t)}
        // Слиянию нужен простор под выпадающий список категорий: на телефоне — на всю высоту.
        fullHeight={dialog?.type === 'merge'}
        returnFocus={returnFocus}
        onExitTransitionEnd={() => {
          afterClose.current?.()
          afterClose.current = null
        }}
      >
        {dialog?.type === 'create' && (
          <CategoryNameForm
            key={dialogKey}
            submitLabel={
              dialog.parent ? t.categories.form.createSubSubmit : t.categories.form.createSubmit
            }
            onSubmit={async (name) => {
              await actions.create(dialog.kind, dialog.parent?.id ?? null, name)
              close()
            }}
          />
        )}
        {dialog?.type === 'rename' && (
          <CategoryNameForm
            key={dialogKey}
            initialName={dialog.category.name}
            submitLabel={t.categories.form.renameSubmit}
            onSubmit={async (name) => {
              await actions.rename(dialog.category.id, name)
              close()
            }}
          />
        )}
        {dialog?.type === 'move' && (
          <MoveCategoryForm
            key={dialogKey}
            category={dialog.category}
            nodes={activeTree(categories, dialog.category.kind)}
            // Считаются и архивные подкатегории: с ними сервер тоже не даст вложить.
            hasChildren={childrenOf(categories, dialog.category.id).length > 0}
            onSubmit={(parentId) => {
              close()
              // В конец нового родителя: индекс больше числа соседей — «в конец» (api.md).
              const index = toMoveIndex(categories, dialog.category.id, parentId, Infinity)
              actions.move(dialog.category.id, parentId, index)
            }}
          />
        )}
        {dialog?.type === 'merge' && (
          <MergeCategoryForm
            key={dialogKey}
            category={dialog.category}
            categories={categories}
            onSubmit={async (targetId) => {
              const { category } = dialog
              const focusTo = neighbourSelectors(
                categories,
                category.kind,
                category.id,
                withChildren(categories, category.id),
              )
              await actions.merge(category, targetId)
              // Окно вернуло бы фокус на удалённую строку — ведём его к соседней.
              setReturnFocus(false)
              afterClose.current = () => focusFirst(focusTo)
              close()
            }}
          />
        )}
      </ResponsiveSheet>
    </>
  )
}

function dialogTitle(dialog: Dialog, t: ReturnType<typeof useT>): string {
  switch (dialog.type) {
    case 'create':
      return dialog.parent
        ? t.categories.form.createSubTitle(dialog.parent.name)
        : t.categories.form.createTitle
    case 'rename':
      return t.categories.form.renameTitle
    case 'move':
      return t.categories.move.title(dialog.category.name)
    case 'merge':
      return t.categories.merge.title(dialog.category.name)
  }
}

function KindPanel({
  kind,
  categories,
  mobile,
  addButton,
  onAction,
  onAdd,
  onRestore,
  onMove,
}: {
  kind: CategoryKind
  categories: readonly Category[]
  mobile: boolean
  addButton: ReactNode
  onAction: (action: CategoryAction, category: Category) => void
  onAdd: () => void
  onRestore: (id: string) => void
  onMove: (id: string, parentId: string | null, index: number) => void
}) {
  const t = useT()
  const nodes = useMemo(() => activeTree(categories, kind), [categories, kind])
  const archived = useMemo(() => archivedEntries(categories, kind), [categories, kind])

  return (
    <>
      {nodes.length === 0 ? (
        <Paper withBorder radius="lg">
          <EmptyState
            icon={IconCategory}
            title={t.categories.emptyTitle[kind]}
            description={t.categories.emptyDescription}
            action={
              <Button
                variant="light"
                leftSection={<IconPlus size={icons.size.md} stroke={icons.stroke} />}
                onClick={onAdd}
                data-add-category
              >
                {t.categories.add}
              </Button>
            }
          />
        </Paper>
      ) : (
        <>
          {mobile && <Box mb="md">{addButton}</Box>}
          <Paper withBorder radius="lg">
            <CategoryTree
              nodes={nodes}
              label={t.categories.treeLabel[kind]}
              onAction={onAction}
              onMove={({ id, parentId, visibleIndex }) =>
                onMove(id, parentId, toMoveIndex(categories, id, parentId, visibleIndex))
              }
            />
          </Paper>
        </>
      )}
      <ArchiveSection entries={archived} onRestore={onRestore} />
    </>
  )
}
