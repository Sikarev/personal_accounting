import { Box, Button, Paper, Tabs } from '@mantine/core'
import { IconAlertCircle, IconCategory, IconPlus } from '@tabler/icons-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'

import { paths } from '../../app/navigation'
import { apiErrorText, useListCategories, type Category, type CategoryKind } from '../../shared/api'
import { useT } from '../../shared/i18n'
import { activeTree, archivedEntries, childrenOf, toMoveIndex } from '../../shared/lib/categoryTree'
import { useDelayedLoading } from '../../shared/lib/useDelayedLoading'
import { useMobileLayout } from '../../shared/lib/useMobileLayout'
import { EmptyState, PageHeader, ResponsiveSheet } from '../../shared/ui'
import { icons } from '../../theme'
import { ArchiveSection } from './categories/ArchiveSection'
import { CategoryNameForm } from './categories/CategoryNameForm'
import { CategoryTree, type CategoryAction } from './categories/CategoryTree'
import { CategoryTreeSkeleton } from './categories/CategoryTreeSkeleton'
import { MergeCategoryForm } from './categories/MergeCategoryForm'
import { MoveCategoryForm } from './categories/MoveCategoryForm'
import { useCategoryActions } from './categories/useCategoryActions'

const KINDS: CategoryKind[] = ['expense', 'income']

/** Вид категорий — в адресе (`?kind=income`): ссылка и «Назад» открывают ту же вкладку. */
function kindFromParams(params: URLSearchParams): CategoryKind {
  return params.get('kind') === 'income' ? 'income' : 'expense'
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
  const open = (next: Dialog) => {
    setDialog(next)
    setDialogKey((k) => k + 1)
    setOpened(true)
  }
  const close = () => setOpened(false)

  const categories = useMemo(() => query.data?.items ?? [], [query.data])
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
        return actions.archive(category)
    }
  }

  const addButton = (fullWidth: boolean) => (
    <Button
      size="md"
      variant={fullWidth ? 'light' : 'filled'}
      fullWidth={fullWidth}
      leftSection={<IconPlus size={icons.size.md} stroke={icons.stroke} />}
      onClick={() => open({ type: 'create', kind, parent: null })}
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
                  actions={actions}
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
            hasChildren={childrenOf(categories, dialog.category.id).some(
              (c) => c.archivedAt === null,
            )}
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
              await actions.merge(dialog.category, targetId)
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
  actions,
}: {
  kind: CategoryKind
  categories: readonly Category[]
  mobile: boolean
  addButton: ReactNode
  onAction: (action: CategoryAction, category: Category) => void
  onAdd: () => void
  actions: ReturnType<typeof useCategoryActions>
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
                actions.move(id, parentId, toMoveIndex(categories, id, parentId, visibleIndex))
              }
            />
          </Paper>
        </>
      )}
      <ArchiveSection entries={archived} onRestore={(id) => void actions.unarchive(id)} />
    </>
  )
}
