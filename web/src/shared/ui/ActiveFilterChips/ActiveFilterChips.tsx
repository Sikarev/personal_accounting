import { Button } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import { useEffect, useRef } from 'react'

import { icons } from '../../../theme'
import { useT } from '../../i18n'
import classes from './ActiveFilterChips.module.css'

/** Активный фильтр: подпись и что сбросить, чтобы его убрать (`without` — патч фильтров). */
export type FilterChip<Patch> = {
  key: string
  label: string
  without: Patch
}

export type ActiveFilterChipsProps<Patch> = {
  chips: FilterChip<Patch>[]
  /** Убрать фильтр: применить `chip.without`. */
  onRemove: (without: Patch) => void
  /** «Сбросить всё». */
  onReset: () => void
  /**
   * Куда поставить фокус, когда чипов не осталось (CSS-селектор): поле поиска ленты,
   * поле периода отчёта.
   */
  fallbackFocus: string
}

const CHIP = 'data-filter-chip'

/**
 * Активные фильтры чипами (ux.md, «Лента»): каждый снимается крестиком, «Сбросить всё».
 * Снятый чип исчезает вместе с фокусом — фокус переходит на соседний чип, а если чипов
 * не осталось, на `fallbackFocus` (иначе он упал бы на `body`).
 */
export function ActiveFilterChips<Patch>({
  chips,
  onRemove,
  onReset,
  fallbackFocus,
}: ActiveFilterChipsProps<Patch>) {
  const t = useT()
  // Снятый чип (`null` ключ — «Сбросить всё») и его позиция. Фокус ставится, когда чипа
  // уже нет на экране: адрес обновляется не мгновенно, и перерисовка до этого момента
  // нашла бы на прежнем месте тот же чип.
  const pendingFocus = useRef<{ key: string | null; index: number } | null>(null)
  useEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return
    const gone =
      pending.key === null ? chips.length === 0 : !chips.some((c) => c.key === pending.key)
    if (!gone) return
    pendingFocus.current = null
    const rest = document.querySelectorAll<HTMLElement>(`[${CHIP}]`)
    const target = rest[Math.min(pending.index, rest.length - 1)]
    ;(target ?? document.querySelector<HTMLElement>(fallbackFocus))?.focus()
  })

  if (chips.length === 0) return null
  return (
    <div className={classes.activeChips}>
      <ul aria-label={t.feed.filters.activeLabel} className={classes.chipList}>
        {chips.map((chip, index) => (
          <li key={chip.key} className={classes.chipItem}>
            <Button
              variant="light"
              size="sm"
              radius="xl"
              className={classes.activeChip}
              rightSection={<IconX size={icons.size.md} stroke={icons.stroke} aria-hidden />}
              aria-label={t.feed.filters.remove(chip.label)}
              onClick={() => {
                pendingFocus.current = { key: chip.key, index }
                onRemove(chip.without)
              }}
              {...{ [CHIP]: true }}
            >
              <span className={classes.activeChipText}>{chip.label}</span>
            </Button>
          </li>
        ))}
      </ul>
      <Button
        variant="subtle"
        size="sm"
        className={classes.touchButton}
        onClick={() => {
          pendingFocus.current = { key: null, index: 0 }
          onReset()
        }}
      >
        {t.feed.resetAll}
      </Button>
    </div>
  )
}
