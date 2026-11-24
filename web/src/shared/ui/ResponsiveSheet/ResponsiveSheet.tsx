import { Drawer, Modal } from '@mantine/core'
import { useEffect, useState, type ReactNode, type RefObject } from 'react'
import { useInRouterContext, useLocation, useNavigate, useNavigationType } from 'react-router'

import { useT } from '../../i18n'
import { useCloseOnBack } from '../../lib/useCloseOnBack'
import { useMobileLayout } from '../../lib/useMobileLayout'
import classes from './ResponsiveSheet.module.css'

export type ResponsiveSheetProps = {
  opened: boolean
  onClose: () => void
  /** Заголовок окна; он же доступное имя диалога. */
  title: ReactNode
  children: ReactNode
  /**
   * На mobile — на всю высоту экрана (формы ввода, ux.md: быстрый ввод «на всю высоту»).
   * Без него панель по высоте содержимого.
   */
  fullHeight?: boolean
  /** Ширина модалки на desktop. */
  desktopSize?: 'sm' | 'md' | 'lg'
  /**
   * Вернуть фокус на кнопку, открывшую окно (по умолчанию да). Выключают, когда
   * действие в окне убрало эту кнопку со страницы (счёт удалён или ушёл в архив):
   * фокус тогда ставит сам экран в `onExitTransitionEnd`, иначе он упал бы на `body`.
   */
  returnFocus?: boolean
  /** Окно закрылось и доиграло анимацию: содержимое уже размонтировано. */
  onExitTransitionEnd?: () => void
  /**
   * Запись окна ушла из истории «Назад» (`useCloseOnBack`). Следующее окно открывать
   * после этого, а не сразу после закрытия.
   */
  onHistoryReleased?: () => void
}

/**
 * Панель поверх экрана: на mobile — bottom sheet (выезжает снизу, удобно одной рукой),
 * на desktop — модальное окно по центру.
 *
 * Вид (sheet или модалка) выбирается в момент открытия и не меняется, пока окно открыто:
 * при повороте телефона или изменении ширины окна Drawer не подменяется на Modal,
 * и содержимое (например, введённая сумма) не пересоздаётся.
 *
 * Доступность обеспечивает Mantine: фокус переходит внутрь и не выходит за пределы окна,
 * `Esc` и клик по подложке закрывают, после закрытия фокус возвращается на кнопку,
 * которая открыла окно.
 *
 * Системная кнопка «Назад» закрывает окно (`useCloseOnBack`): открытое окно добавляет
 * запись в историю. Ссылка внутри окна должна переходить с `replace: true`, иначе
 * в истории останется лишний шаг с адресом экрана под окном.
 */
export function ResponsiveSheet({
  opened,
  onClose,
  title,
  children,
  fullHeight = false,
  desktopSize = 'md',
  returnFocus = true,
  onExitTransitionEnd,
  onHistoryReleased,
}: ResponsiveSheetProps) {
  const mobileNow = useMobileLayout()
  const [isMobile, setIsMobile] = useState(mobileNow)
  const [wasOpened, setWasOpened] = useState(opened)
  // Фиксируем вид при открытии. Это «подстройка состояния под пропсы» прямо в рендере
  // (рекомендуемый React способ вместо эффекта): лишнего кадра с другим видом не будет.
  // После закрытия вид тоже не трогаем: окно ещё доигрывает анимацию закрытия
  // и возвращает фокус — подмена компонента в этот момент сломала бы и то и другое.
  if (opened !== wasOpened) {
    setWasOpened(opened)
    if (opened) setIsMobile(mobileNow)
  }

  const { restoreMarker, replaceUrlRef } = useCloseOnBack(opened, onClose, onHistoryReleased)
  // Роутера может не быть (Storybook) — тогда синхронизация с ним не нужна.
  const inRouter = useInRouterContext()
  const routerSync = inRouter && (
    <RouterSync onReplace={restoreMarker} replaceUrlRef={replaceUrlRef} />
  )

  const t = useT()
  const closeButtonProps = { 'aria-label': t.common.close }

  if (isMobile) {
    return (
      <>
        {routerSync}
        <Drawer
          opened={opened}
          onClose={onClose}
          title={title}
          position="bottom"
          size={fullHeight ? '100%' : 'auto'}
          returnFocus={returnFocus}
          onExitTransitionEnd={onExitTransitionEnd}
          closeButtonProps={closeButtonProps}
          classNames={{
            content: fullHeight ? classes.sheetFull : classes.sheet,
            header: classes.header,
            title: classes.title,
            body: classes.body,
          }}
        >
          {children}
        </Drawer>
      </>
    )
  }

  return (
    <>
      {routerSync}
      <Modal
        opened={opened}
        onClose={onClose}
        title={title}
        size={desktopSize}
        returnFocus={returnFocus}
        onExitTransitionEnd={onExitTransitionEnd}
        radius="lg"
        centered
        closeButtonProps={closeButtonProps}
        classNames={{ header: classes.header, title: classes.title, body: classes.body }}
      >
        {children}
      </Modal>
    </>
  )
}

/**
 * Связь окна с React Router (`useCloseOnBack`): замена адреса изнутри открытого окна
 * (`replace: true` — фильтры, вкладки) стирает метку окна в `history.state` — возвращаем её;
 * переход с заменой адреса для закрытия окна — через роутер, чтобы он увидел новый адрес.
 */
function RouterSync({
  onReplace,
  replaceUrlRef,
}: {
  onReplace: () => void
  replaceUrlRef: RefObject<((url: string) => void) | null>
}) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()

  useEffect(() => {
    replaceUrlRef.current = (url) => {
      const { pathname, search, hash } = new URL(url)
      void navigate(pathname + search + hash, { replace: true })
    }
  }, [navigate, replaceUrlRef])

  useEffect(() => {
    if (navigationType === 'REPLACE') onReplace()
  }, [location, navigationType, onReplace])

  return null
}
