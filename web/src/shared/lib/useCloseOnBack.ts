import { useCallback, useEffect, useRef } from 'react'

/**
 * Системная кнопка «Назад» (Android, жест, кнопка браузера) закрывает открытое окно,
 * а не уводит с экрана (техдолг №3).
 *
 * Как устроено:
 * - при открытии окна в историю добавляется запись с тем же адресом, в её `state` —
 *   метка окна (`__sheets`: метки открытых окон по порядку, у вложенного — длиннее);
 * - «Назад» уходит с этой записи (`popstate`): окна, чьей метки нет в `state` новой
 *   текущей записи, закрываются. Вложенное окно закрывается одно, внешнее остаётся;
 * - окно закрыли иначе (крестик, Esc, выбор в списке) — добавленная запись больше не нужна,
 *   уходим с неё сами (`history.back()`), чтобы «Назад» потом не тратил нажатие
 *   на «пустой» шаг. Только если она ещё текущая: если из окна перешли по ссылке,
 *   запись уже не наша — её не трогаем.
 *
 * Метки уникальны (UUID): после перезагрузки страницы в `state` остаются метки прежних
 * окон, и с повторяющимися номерами «Назад» принимал бы новое окно за старое. В новую
 * запись попадают только метки окон, открытых сейчас.
 *
 * React Router запись не замечает: адрес тот же, а `state` роутера (`usr`, `key`, `idx`)
 * копируется в новую запись. Но `navigate(…, { replace: true })` изнутри открытого окна
 * (фильтры, вкладки) перезаписывает `state` целиком и стирает метку — тогда её возвращает
 * `restoreMarker` (его вызывает `ResponsiveSheet` при замене адреса). Адрес, сменённый так
 * внутри окна, при закрытии переносится на запись под окном (`replaceUrlRef`) — иначе
 * `history.back()` вернул бы прежние фильтры.
 *
 * `history.back()` откладывается на задачу: в StrictMode эффект снимается и ставится
 * заново без закрытия окна — тогда запись переиспользуется, а не «отматывается».
 */
const SHEETS_KEY = '__sheets'

/** Метки окон, открытых сейчас, в порядке открытия (одна история на вкладку — один список). */
const openSheets: string[] = []

let sequence = 0

function newSheetId(): string {
  sequence += 1
  // randomUUID есть только в защищённом контексте (https, localhost).
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${sequence}`
}

/** Метки окон в `history.state`. */
export function sheetsOf(state: unknown): string[] {
  const sheets = (state as Record<string, unknown> | null)?.[SHEETS_KEY]
  return Array.isArray(sheets) ? (sheets as string[]) : []
}

/** `state` записи с метками окон (остальные поля — роутера — сохраняются). */
export function withSheets(state: unknown, sheets: string[]): Record<string, unknown> {
  return { ...((state as Record<string, unknown> | null) ?? {}), [SHEETS_KEY]: sheets }
}

function forget(id: string) {
  const index = openSheets.indexOf(id)
  if (index !== -1) openSheets.splice(index, 1)
}

/** Перенести адрес на текущую запись (без роутера — напрямую в историю). */
function replaceUrlDirectly(url: string) {
  window.history.replaceState(window.history.state, '', url)
}

/**
 * `onReleased` — запись окна ушла из истории (или её и не было): после `popstate`
 * от нашего `history.back()`, после «Назад» пользователя или сразу, если запись уже
 * не текущая. Следующее окно, открытое раньше, встало бы поверх уходящей записи —
 * и «Назад» потом закрывал бы не то окно.
 */
export function useCloseOnBack(opened: boolean, onClose: () => void, onReleased?: () => void) {
  const idRef = useRef<string | null>(null)
  const activeRef = useRef(false)
  /** Адрес в момент открытия: сменился внутри окна — перенести его на запись под окном. */
  const openUrlRef = useRef('')
  /** Переход с заменой адреса через роутер (ставит `ResponsiveSheet`, если роутер есть). */
  const replaceUrlRef = useRef<((url: string) => void) | null>(null)
  const onCloseRef = useRef(onClose)
  const onReleasedRef = useRef(onReleased)
  useEffect(() => {
    onCloseRef.current = onClose
    onReleasedRef.current = onReleased
  })

  useEffect(() => {
    if (!opened) return
    activeRef.current = true
    const current = sheetsOf(window.history.state)
    let id = idRef.current
    // Повторный запуск эффекта (StrictMode) — запись окна на месте, новая не нужна.
    if (id === null || current.at(-1) !== id) {
      id = newSheetId()
      idRef.current = id
      openUrlRef.current = window.location.href
      const parents = current.filter((s) => openSheets.includes(s))
      window.history.pushState(withSheets(window.history.state, [...parents, id]), '')
    }
    if (!openSheets.includes(id)) openSheets.push(id)
    const ownId = id

    const handlePopState = (event: PopStateEvent) => {
      if (sheetsOf(event.state).includes(ownId)) return
      // Записи окна в истории больше нет — отматывать при закрытии нечего.
      idRef.current = null
      forget(ownId)
      onCloseRef.current()
      onReleasedRef.current?.()
    }
    window.addEventListener('popstate', handlePopState)

    return () => {
      activeRef.current = false
      window.removeEventListener('popstate', handlePopState)
      setTimeout(() => {
        // Окно снова открыто (перезапуск эффекта) или запись уже ушла через «Назад».
        if (activeRef.current || idRef.current !== ownId) return
        idRef.current = null
        forget(ownId)
        if (sheetsOf(window.history.state).at(-1) !== ownId) {
          onReleasedRef.current?.()
          return
        }
        window.addEventListener('popstate', () => onReleasedRef.current?.(), { once: true })
        const url = window.location.href
        if (url !== openUrlRef.current) {
          // Нужна именно текущая функция роутера, а не снятая при открытии окна.
          // oxlint-disable-next-line react-hooks/exhaustive-deps
          const replaceUrl = replaceUrlRef.current ?? replaceUrlDirectly
          window.addEventListener('popstate', () => replaceUrl(url), { once: true })
        }
        window.history.back()
      })
    }
  }, [opened])

  /** Вернуть метку окна, если запись перезаписали заменой адреса изнутри окна. */
  const restoreMarker = useCallback(() => {
    const id = idRef.current
    if (!id || !activeRef.current || sheetsOf(window.history.state).includes(id)) return
    // Замена на другой экран («Создать счёт» из пустого окна) — уход с экрана, а не смена
    // фильтров: окно закрывается, метку не возвращаем.
    if (new URL(openUrlRef.current).pathname !== window.location.pathname) return
    const upTo = openSheets.indexOf(id)
    const sheets = upTo === -1 ? [id] : openSheets.slice(0, upTo + 1)
    window.history.replaceState(withSheets(window.history.state, sheets), '')
  }, [])

  return { restoreMarker, replaceUrlRef }
}
