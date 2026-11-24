import { UnstyledButton } from '@mantine/core'
import { IconPlus } from '@tabler/icons-react'
import { Link, useLocation } from 'react-router'

import { useOnboarding } from '../../features/onboarding/onboardingContext'
import { useQuickAdd } from '../../features/quick-add/quickAddContext'
import { useT } from '../../shared/i18n'
import { icons } from '../../theme'
import { bottomNavItems, isNavItemActive, type NavItem } from '../navigation'
import classes from './BottomNav.module.css'

/**
 * Нижняя панель mobile: Главная · Операции · [+] · Отчёты · Ещё.
 * Под большой палец: пункты на всю ширину, высота зоны касания ≥ 44 px,
 * отступ под системную полоску «домой» (safe-area).
 */
export function BottomNav() {
  const t = useT()
  const quickAdd = useQuickAdd()
  // Онбординг (шаг 2) показывает, где вносить операции, — кнопка «+» выделена кольцом.
  const { introVisible } = useOnboarding()
  const { pathname } = useLocation()

  const renderItem = (item: NavItem) => {
    const active = isNavItemActive(item, pathname)
    return (
      <Link
        key={item.to}
        to={item.to}
        className={classes.item}
        data-active={active || undefined}
        aria-current={active ? 'page' : undefined}
      >
        <span className={classes.iconWrap}>
          <item.icon size={icons.size.lg} stroke={icons.stroke} aria-hidden />
        </span>
        <span className={classes.label}>{t.nav[item.label]}</span>
      </Link>
    )
  }

  return (
    <nav aria-label={t.nav.label} className={classes.root}>
      {bottomNavItems.start.map(renderItem)}
      <div className={classes.addSlot}>
        <UnstyledButton
          className={classes.add}
          data-highlight={introVisible || undefined}
          onClick={() => quickAdd.open()}
          aria-label={t.nav.addTransaction}
          aria-haspopup="dialog"
        >
          <IconPlus size={icons.size.lg} stroke={icons.stroke} aria-hidden />
        </UnstyledButton>
      </div>
      {bottomNavItems.end.map(renderItem)}
    </nav>
  )
}
