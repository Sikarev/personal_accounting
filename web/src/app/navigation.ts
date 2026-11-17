import {
  IconChartPie,
  IconDots,
  IconHome2,
  IconListDetails,
  IconSettings,
  IconWallet,
  type Icon,
} from '@tabler/icons-react'

import type { Messages } from '../shared/i18n'

/** Адреса экранов. Ссылки строим только через эти константы. */
export const paths = {
  home: '/',
  transactions: '/transactions',
  reports: '/reports',
  accounts: '/accounts',
  settings: '/settings',
  more: '/more',
} as const

export type NavItem = {
  to: string
  /** Ключ подписи в `t.nav`. */
  label: keyof Messages['nav']
  icon: Icon
}

const home: NavItem = { to: paths.home, label: 'home', icon: IconHome2 }
const transactions: NavItem = {
  to: paths.transactions,
  label: 'transactions',
  icon: IconListDetails,
}
const reports: NavItem = { to: paths.reports, label: 'reports', icon: IconChartPie }
const accounts: NavItem = { to: paths.accounts, label: 'accounts', icon: IconWallet }
const settings: NavItem = { to: paths.settings, label: 'settings', icon: IconSettings }
const more: NavItem = { to: paths.more, label: 'more', icon: IconDots }

/** Боковое меню desktop: все разделы сразу. */
export const sidebarItems: NavItem[] = [home, transactions, reports, accounts, settings]

/**
 * Нижняя панель mobile (requirements, раздел 6): Главная · Операции · [+] · Отчёты · Ещё.
 * Кнопка «+» стоит между двумя половинами.
 */
export const bottomNavItems = {
  start: [home, transactions],
  end: [reports, more],
} as const

/** Разделы, спрятанные в «Ещё» на mobile: пока открыт любой из них, подсвечен пункт «Ещё». */
export const moreItems: NavItem[] = [accounts, settings]

function matchesPath(to: string, pathname: string): boolean {
  if (to === paths.home) return pathname === paths.home
  return pathname === to || pathname.startsWith(`${to}/`)
}

/** Активен ли пункт меню на текущем адресе (вложенные адреса раздела тоже считаются). */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item === more) {
    return matchesPath(paths.more, pathname) || moreItems.some((i) => matchesPath(i.to, pathname))
  }
  return matchesPath(item.to, pathname)
}
