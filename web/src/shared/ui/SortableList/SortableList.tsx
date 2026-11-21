import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ActionIcon } from '@mantine/core'
import { useReducedMotion } from '@mantine/hooks'
import { IconGripVertical } from '@tabler/icons-react'
import type { ReactNode } from 'react'

import { useT } from '../../i18n'
import { icons } from '../../../theme'
import classes from './SortableList.module.css'

export type SortableListProps<T> = {
  items: readonly T[]
  getId: (item: T) => string
  /** Название элемента для подписи ручки («Переместить «Карта»») и объявлений диктора. */
  getLabel: (item: T) => string
  /** Содержимое строки; ручку перетаскивания список добавляет сам, справа. */
  renderItem: (item: T) => ReactNode
  /**
   * Новый порядок после перетаскивания — id всех элементов списка.
   * Вызывается, только если порядок изменился. Список управляемый: показывает `items`,
   * поэтому для мгновенного отклика родитель сразу применяет порядок у себя
   * (оптимистично) и откатывает при ошибке сервера.
   */
  onReorder: (ids: string[]) => void
  /** Доступное имя списка («Общие счета»). */
  'aria-label'?: string
}

// Перетаскивание только по вертикали: список плоский, сдвиг вбок ничего не значит.
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 })

/**
 * Плоский вертикальный список с перетаскиванием (`@dnd-kit`).
 *
 * Перетаскивают за ручку справа — так касание строки остаётся «открыть», а свайп
 * по строке — прокруткой страницы (у ручки `touch-action: none`).
 * - Мышь и касание: потянуть ручку (PointerSensor, старт после сдвига на несколько px,
 *   чтобы простое нажатие не считалось перетаскиванием).
 * - Клавиатура: фокус на ручке, Space/Enter — взять, стрелки — двигать, Space/Enter —
 *   поставить, Esc — отменить.
 * - Экранный диктор: русская инструкция и объявления «взят / позиция N из M / поставлен».
 * - `prefers-reduced-motion`: соседние строки переставляются без анимации.
 */
export function SortableList<T>({
  items,
  getId,
  getLabel,
  renderItem,
  onReorder,
  'aria-label': ariaLabel,
}: SortableListProps<T>) {
  const t = useT()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const ids = items.map(getId)
  const labelOf = (id: UniqueIdentifier) => {
    const item = items.find((i) => getId(i) === id)
    return item ? getLabel(item) : String(id)
  }
  const positionOf = (id: UniqueIdentifier | undefined) =>
    id === undefined ? 0 : ids.indexOf(String(id)) + 1

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t.sortable.picked(labelOf(active.id), positionOf(active.id), ids.length),
    onDragOver: ({ active, over }) =>
      over ? t.sortable.moved(labelOf(active.id), positionOf(over.id), ids.length) : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t.sortable.dropped(labelOf(active.id), positionOf(over.id), ids.length)
        : t.sortable.cancelled(labelOf(active.id)),
    onDragCancel: ({ active }) => t.sortable.cancelled(labelOf(active.id)),
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onReorder(arrayMove(ids, from, to))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t.sortable.instructions },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className={classes.list} aria-label={ariaLabel}>
          {items.map((item) => (
            <SortableRow
              key={getId(item)}
              id={getId(item)}
              label={getLabel(item)}
              // Одному элементу двигаться некуда — ручку не показываем.
              withHandle={items.length > 1}
            >
              {renderItem(item)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function SortableRow({
  id,
  label,
  withHandle,
  children,
}: {
  id: string
  label: string
  withHandle: boolean
  children: ReactNode
}) {
  const t = useT()
  const reduceMotion = useReducedMotion()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled: !withHandle,
    // Без анимации перестановки соседей при reduced motion (ux.md, раздел 6).
    transition: reduceMotion ? null : undefined,
    attributes: { roleDescription: t.sortable.roleDescription },
  })

  return (
    <li
      ref={setNodeRef}
      className={classes.item}
      data-dragging={isDragging || undefined}
      // Translate, а не Transform: без масштабирования строки разной высоты не сплющиваются.
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div className={classes.content}>{children}</div>
      {withHandle && (
        <ActionIcon
          ref={setActivatorNodeRef}
          variant="subtle"
          color="gray"
          size="xl"
          className={classes.handle}
          {...attributes}
          {...listeners}
          aria-label={t.sortable.handle(label)}
          // Экран может скрыть ручку в узкой раскладке, если у него есть другой способ
          // менять порядок (кнопки «Выше» / «Ниже»).
          data-sortable-handle
        >
          <IconGripVertical size={icons.size.md} stroke={icons.stroke} />
        </ActionIcon>
      )}
    </li>
  )
}
