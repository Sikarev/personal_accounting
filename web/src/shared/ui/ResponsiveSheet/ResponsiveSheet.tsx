import { Drawer, Modal } from '@mantine/core'
import type { ReactNode } from 'react'

import { useT } from '../../i18n'
import { useIsMobile } from '../../lib/useIsMobile'
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
  const isMobile = useIsMobile()
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
