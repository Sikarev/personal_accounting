import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ActionIcon, Menu, Text } from '@mantine/core'
import { useReducedMotion } from '@mantine/hooks'
import {
  IconArchive,
  IconArrowDown,
  IconArrowUp,
  IconArrowsMove,
  IconDotsVertical,
  IconGripVertical,
  IconPencil,
  IconSubtask,
  IconTrash,
} from '@tabler/icons-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { Category } from '../../../shared/api'
import { useT, type Messages } from '../../../shared/i18n'
import type { CategoryNode } from '../../../shared/lib/categoryTree'
import { icons } from '../../../theme'
import classes from './CategoryTree.module.css'
import {
  currentPlace,
  flattenTree,
  getProjection,
  withoutChildrenOf,
  type FlatItem,
  type Projection,
} from './treeProjection'

/**
 * Шаг уровня при перетаскивании до первого замера, px. Настоящий шаг измеряется в начале
 * перетаскивания по визуальному отступу подкатегории (`--tree-indent` в CSS): он в rem и
 * растёт с системным шрифтом, а в узком контейнере уменьшается.
 */
const DEFAULT_INDENT_PX = 32

export type CategoryAction = 'rename' | 'addSub' | 'up' | 'down' | 'move' | 'archive' | 'merge'

export type CategoryMove = {
  id: string
  parentId: string | null
  /** Позиция среди видимых (активных) соседей у нового родителя. */
  visibleIndex: number
}

export type CategoryTreeProps = {
  /** Активное дерево одного вида (`activeTree`). */
  nodes: readonly CategoryNode[]
  /** Доступное имя списка: «Категории расходов». */
  label: string
  onMove: (move: CategoryMove) => void
  onAction: (action: CategoryAction, category: Category) => void
}

/**
 * Дерево категорий с перетаскиванием (@dnd-kit): порядок среди соседей, перенос подкатегории
 * к другому родителю или на верхний уровень, категории без подкатегорий — внутрь другой.
 *
 * - Мышь и касание: тянуть за ручку; сдвиг вправо/влево меняет уровень. У ручки
 *   `touch-action: none`, поэтому прокрутка пальцем по остальной строке работает как обычно.
 * - Клавиатура: пробел/Enter на ручке — взять, стрелки вверх/вниз — место, вправо/влево —
 *   уровень, пробел/Enter — положить, Esc — отменить. Озвучка (`announcements`
 *   и инструкции @dnd-kit) — по-русски.
 * - `prefers-reduced-motion`: строки переставляются без анимации.
 *
 * Без перетаскивания (WCAG 2.5.7) — пункты меню строки «Выше», «Ниже» и «Переместить в…».
 * В узком контейнере (крупный шрифт на телефоне) ручка скрыта — остаются они.
 */
export function CategoryTree({ nodes, label, onMove, onAction }: CategoryTreeProps) {
  const t = useT()
  const reducedMotion = useReducedMotion()

  const flat = useMemo(() => flattenTree(nodes), [nodes])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [offsetX, setOffsetX] = useState(0)
  const [indent, setIndent] = useState(DEFAULT_INDENT_PX)
  const indentProbe = useRef<HTMLSpanElement>(null)

  const items = useMemo(() => withoutChildrenOf(flat, activeId), [flat, activeId])
  const projection =
    activeId && overId ? getProjection(items, activeId, overId, offsetX, indent) : null

  // Состояние перетаскивания дублируется в ref: @dnd-kit вызывает `announcements` и
  // `coordinateGetter` синхронно, в том же обработчике события, до перерисовки — значения
  // из состояния там были бы на шаг позади.
  const drag = useRef({
    activeId: null as string | null,
    overId: null as string | null,
    offsetX: 0,
    indent: DEFAULT_INDENT_PX,
  })
  const itemsRef = useRef(items)
  useLayoutEffect(() => {
    itemsRef.current = items
  }, [items])
  const endMessage = useRef<string | undefined>(undefined)
  const lastMessage = useRef<string | undefined>(undefined)

  const projectNow = (): Projection | null => {
    const { activeId: a, overId: o, offsetX: x, indent: step } = drag.current
    return a && o ? getProjection(itemsRef.current, a, o, x, step) : null
  }

  // Стрелки вправо/влево меняют уровень: сдвигаем «курсор» на шаг отступа, но не дальше
  // допустимого (иначе пришлось бы жать обратно несколько раз). Вверх/вниз — штатный
  // переход к соседней строке @dnd-kit, с сохранением выбранного сдвига.
  const coordinateGetter: KeyboardCoordinateGetter = (event, args) => {
    const { currentCoordinates } = args
    if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
      event.preventDefault()
      const active = itemsRef.current.find((i) => i.id === drag.current.activeId)
      const current = projectNow()
      if (!active || !current || !current.valid) return currentCoordinates
      const wantedDepth = Math.min(
        1,
        Math.max(0, current.depth + (event.code === 'ArrowRight' ? 1 : -1)),
      )
      const offset = (wantedDepth - active.depth) * drag.current.indent
      return { x: currentCoordinates.x - drag.current.offsetX + offset, y: currentCoordinates.y }
    }
    const next = sortableKeyboardCoordinates(event, args)
    return next && { x: next.x + drag.current.offsetX, y: next.y }
  }

  const sensors = useSensors(
    // Небольшой порог: клик по ручке без движения не начинает перетаскивание.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter,
      // Прокрутка к строке — мгновенная (и без анимации для prefers-reduced-motion).
      // С плавной (умолчание @dnd-kit) в длинном списке частые нажатия стрелки
      // считались от ещё не докрученной страницы, и строка «застревала» на полпути.
      scrollBehavior: 'auto',
    }),
  )

  const nameOf = (id: string | null) => flat.find((i) => i.id === id)?.name ?? ''

  const describe = (p: Projection | null): string | undefined => {
    const name = nameOf(drag.current.activeId)
    if (!p) return undefined
    if (!p.valid) return t.categories.dnd.notAllowed(name)
    const place = p.parentId
      ? t.categories.dnd.inParent(nameOf(p.parentId))
      : t.categories.dnd.topLevel
    return t.categories.dnd.position(name, place, p.index + 1, p.total)
  }

  // Повтор той же фразы диктор не озвучивает заново — отдаём только изменения.
  const announceChange = () => {
    const message = describe(projectNow())
    if (message === lastMessage.current) return undefined
    lastMessage.current = message
    return message
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      lastMessage.current = undefined
      return t.categories.dnd.picked(nameOf(String(active.id)))
    },
    onDragOver: announceChange,
    onDragMove: announceChange,
    onDragEnd: () => endMessage.current,
    onDragCancel: ({ active }) => t.categories.dnd.cancelled(nameOf(String(active.id))),
  }

  const reset = () => {
    drag.current = { ...drag.current, activeId: null, overId: null, offsetX: 0 }
    setActiveId(null)
    setOverId(null)
    setOffsetX(0)
  }

  const handleDragStart = ({ active }: DragStartEvent) => {
    const id = String(active.id)
    // Шаг уровня = видимый отступ подкатегории сейчас (шрифт и ширина могли измениться).
    const measured = indentProbe.current?.getBoundingClientRect().width || DEFAULT_INDENT_PX
    drag.current = { activeId: id, overId: id, offsetX: 0, indent: measured }
    setIndent(measured)
    setActiveId(id)
    setOverId(id)
    setOffsetX(0)
  }

  const handleDragMove = ({ delta }: DragMoveEvent) => {
    drag.current.offsetX = delta.x
    setOffsetX(delta.x)
  }

  const handleDragOver = ({ over }: DragOverEvent) => {
    const id = over ? String(over.id) : null
    drag.current.overId = id
    setOverId(id)
  }

  const handleDragEnd = ({ active }: DragEndEvent) => {
    const id = String(active.id)
    const p = projectNow()
    const before = currentPlace(flat, id)
    const name = nameOf(id)
    reset()

    if (!p || !p.valid || !before) {
      endMessage.current =
        p && !p.valid ? t.categories.dnd.notAllowed(name) : t.categories.dnd.unchanged(name)
      return
    }
    if (p.parentId === before.parentId && p.index === before.index) {
      endMessage.current = t.categories.dnd.unchanged(name)
      return
    }
    endMessage.current = t.categories.dnd.dropped(name)
    onMove({ id, parentId: p.parentId, visibleIndex: p.index })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t.categories.dnd.instructions },
      }}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={reset}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        {/* Обёртка — контейнер для @container в CSS: раскладка строки зависит от ширины
            списка, а не экрана (крупный шрифт на телефоне). */}
        <div className={classes.tree}>
          <span ref={indentProbe} className={classes.indentProbe} aria-hidden />
          <ul className={classes.list} aria-label={label}>
            {items.map((item) => (
              <SortableRow
                key={item.id}
                item={item}
                moves={availableMoves(flat, nodes, item)}
                depth={item.id === activeId && projection?.valid ? projection.depth : item.depth}
                invalid={item.id === activeId && projection?.valid === false}
                childCount={
                  item.id === activeId ? flat.filter((i) => i.parentId === item.id).length : 0
                }
                reducedMotion={reducedMotion}
                category={nodeById(nodes, item.id)}
                onAction={onAction}
                t={t}
              />
            ))}
          </ul>
        </div>
      </SortableContext>
    </DndContext>
  )
}

/** Какие перемещения без перетаскивания доступны строке — для пунктов меню. */
type RowMoves = { up: boolean; down: boolean; moveTo: boolean }

function availableMoves(
  flat: readonly FlatItem[],
  nodes: readonly CategoryNode[],
  item: FlatItem,
): RowMoves {
  const siblings = flat.filter((i) => i.parentId === item.parentId && i.depth === item.depth)
  const at = siblings.indexOf(item)
  // «Переместить в…» — только если есть куда: подкатегорию — на верхний уровень или к другому
  // родителю; категорию верхнего уровня — внутрь другой (если у неё нет подкатегорий).
  const moveTo = item.depth === 1 || (!item.hasChildren && nodes.some((n) => n.id !== item.id))
  return { up: at > 0, down: at < siblings.length - 1, moveTo }
}

function nodeById(nodes: readonly CategoryNode[], id: string): Category {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = node.children.find((c) => c.id === id)
    if (child) return child
  }
  throw new Error(`category ${id} not in tree`)
}

type SortableRowProps = {
  item: FlatItem
  moves: RowMoves
  /** Уровень для отрисовки: у перетаскиваемой строки — тот, куда она встанет. */
  depth: 0 | 1
  invalid: boolean
  /** Сколько подкатегорий едет вместе с перетаскиваемым родителем. */
  childCount: number
  reducedMotion: boolean
  category: Category
  onAction: CategoryTreeProps['onAction']
  t: Messages
}

function SortableRow({
  item,
  moves,
  depth,
  invalid,
  childCount,
  reducedMotion,
  category,
  onAction,
  t,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    transition: reducedMotion ? null : undefined,
    attributes: { roleDescription: t.categories.dnd.roleDescription },
  })

  // Горизонтальный сдвиг не рисуем: уровень показывает отступ строки, а не её положение
  // под пальцем — так видно, куда именно встанет категория.
  const style = {
    transform: CSS.Translate.toString(transform && { ...transform, x: 0 }),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={classes.row}
      data-depth={depth}
      data-dragging={isDragging || undefined}
      data-invalid={invalid || undefined}
      aria-level={depth + 1}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className={classes.handle}
        {...attributes}
        {...listeners}
        aria-label={t.categories.dnd.handle(item.name)}
      >
        <IconGripVertical size={icons.size.md} stroke={icons.stroke} aria-hidden />
      </button>
      <Text className={classes.name}>
        {item.name}
        {childCount > 0 && (
          <Text span c="dimmed" size="sm">
            {' '}
            +{childCount}
          </Text>
        )}
      </Text>
      <RowMenu category={category} moves={moves} onAction={onAction} t={t} />
    </li>
  )
}

function RowMenu({
  category,
  moves,
  onAction,
  t,
}: {
  category: Category
  moves: RowMoves
  onAction: CategoryTreeProps['onAction']
  t: Messages
}) {
  const icon = (I: typeof IconPencil) => <I size={icons.size.md} stroke={icons.stroke} />
  const isTopLevel = category.parentId === null
  return (
    // Без портала: меню остаётся внутри <main> (axe: всё содержимое — в ориентирах).
    <Menu position="bottom-end" withinPortal={false}>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          radius="xl"
          className={classes.menuButton}
          aria-label={t.categories.actionsLabel(category.name)}
          data-category-menu={category.id}
        >
          <IconDotsVertical size={icons.size.md} stroke={icons.stroke} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={icon(IconPencil)} onClick={() => onAction('rename', category)}>
          {t.categories.rename}
        </Menu.Item>
        {isTopLevel && (
          <Menu.Item leftSection={icon(IconSubtask)} onClick={() => onAction('addSub', category)}>
            {t.categories.addSub}
          </Menu.Item>
        )}
        {moves.up && (
          <Menu.Item leftSection={icon(IconArrowUp)} onClick={() => onAction('up', category)}>
            {t.categories.moveUp}
          </Menu.Item>
        )}
        {moves.down && (
          <Menu.Item leftSection={icon(IconArrowDown)} onClick={() => onAction('down', category)}>
            {t.categories.moveDown}
          </Menu.Item>
        )}
        {moves.moveTo && (
          <Menu.Item leftSection={icon(IconArrowsMove)} onClick={() => onAction('move', category)}>
            {t.categories.moveTo}
          </Menu.Item>
        )}
        <Menu.Item leftSection={icon(IconArchive)} onClick={() => onAction('archive', category)}>
          {t.categories.archive}
        </Menu.Item>
        {/* У Mantine разделитель без роли; внутри role="menu" ему место как separator. */}
        <Menu.Divider role="separator" />
        <Menu.Item
          // Цвет «проблемы» из темы: у color="red" в меню контраст 3.3:1 — ниже AA.
          className={classes.danger}
          leftSection={icon(IconTrash)}
          onClick={() => onAction('merge', category)}
        >
          {t.categories.remove}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
