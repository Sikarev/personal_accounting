import { useEffect, useRef } from 'react'

/**
 * Системная кнопка «Назад» (Android, жест, кнопка браузера) закрывает открытое окно,
 * а не уводит с экрана (техдолг №3).
 *
 * Как устроено:
 * - при открытии окна в историю добавляется запись с тем же адресом, в её `state` —
 *   метка окна (`__sheets`: список меток открытых окон, у вложенного окна — длиннее);
 * - «Назад» уходит с этой записи (`popstate`): окна, чьей метки больше нет в `state`
 *   текущей записи, закрываются. Вложенное окно закрывается одно, внешнее остаётся;
 * - окно закрыли иначе (крестик, Esc, выбор в списке) — добавленная запись больше не нужна,
 *   уходим с неё сами (`history.back()`), чтобы «Назад» потом не тратил нажатие
 *   на «пустой» шаг. Только если она ещё текущая: если из окна перешли по ссылке,
 *   запись уже не наша — её не трогаем.
 *
 * React Router запись не замечает: адрес тот же, а `state` роутера (`usr`, `key`, `idx`)
 * копируется в новую запись, поэтому при возврате на неё и с неё роутер видит прежнее
 * место. Переход по ссылке из открытого окна — с `replace: true`: он заменит запись окна,
 * и в истории не останется лишнего шага.
 *
 * `history.back()` откладывается на задачу: в StrictMode эффект снимается и ставится
 * заново без закрытия окна — тогда запись переиспользуется, а не «отматывается».
 */
const SHEETS_KEY = '__sheets'

let sequence = 0

function sheetsOf(state: unknown): string[] {
  const sheets = (state as Record<string, unknown> | null)?.[SHEETS_KEY]
  return Array.isArray(sheets) ? (sheets as string[]) : []
}

export function useCloseOnBack(opened: boolean, onClose: () => void) {
  const idRef = useRef<string | null>(null)
  const activeRef = useRef(false)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!opened) return
    activeRef.current = true
    const current = sheetsOf(window.history.state)
    let id = idRef.current
    // Повторный запуск эффекта (StrictMode) — запись окна на месте, новая не нужна.
    if (id === null || current.at(-1) !== id) {
      sequence += 1
      id = `sheet-${sequence}`
      idRef.current = id
      window.history.pushState(
        { ...(window.history.state ?? {}), [SHEETS_KEY]: [...current, id] },
        '',
      )
    }
    const ownId = id

    const handlePopState = (event: PopStateEvent) => {
      if (sheetsOf(event.state).includes(ownId)) return
      // Записи окна в истории больше нет — отматывать при закрытии нечего.
      idRef.current = null
      onCloseRef.current()
    }
    window.addEventListener('popstate', handlePopState)

    return () => {
      activeRef.current = false
      window.removeEventListener('popstate', handlePopState)
      setTimeout(() => {
        // Окно снова открыто (перезапуск эффекта) или запись уже ушла через «Назад».
        if (activeRef.current || idRef.current !== ownId) return
        idRef.current = null
        if (sheetsOf(window.history.state).at(-1) === ownId) window.history.back()
      })
    }
  }, [opened])
}
