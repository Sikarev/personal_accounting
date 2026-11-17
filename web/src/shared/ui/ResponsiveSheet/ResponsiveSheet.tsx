import { Drawer, Modal } from '@mantine/core'
import { useState, type ReactNode } from 'react'

import { useT } from '../../i18n'
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
 */
export function ResponsiveSheet({
  opened,
  onClose,
  title,
  children,
  fullHeight = false,
  desktopSize = 'md',
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

  const t = useT()
  const closeButtonProps = { 'aria-label': t.common.close }

  if (isMobile) {
    return (
      <Drawer
        opened={opened}
        onClose={onClose}
        title={title}
        position="bottom"
        size={fullHeight ? '100%' : 'auto'}
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
    )
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size={desktopSize}
      radius="lg"
      centered
      closeButtonProps={closeButtonProps}
      classNames={{ header: classes.header, title: classes.title, body: classes.body }}
    >
      {children}
    </Modal>
  )
}
