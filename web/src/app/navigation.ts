import {
  IconChartPie,
  IconDots,
  IconHome2,
  IconListDetails,
  IconSettings,
  IconWallet,
  type Icon,
} from '@tabler/icons-react'

import { matchPath } from 'react-router'

import type { Messages } from '../shared/i18n'

/** Адреса экранов. Ссылки строим только через эти константы. */
export const paths = {
  home: '/',
  transactions: '/transactions',
  reports: '/reports',
  accounts: '/accounts',
  settings: '/settings',
  settingsCategories: '/settings/categories',
  more: '/more',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',
  legalPrivacy: '/legal/privacy',
  legalTerms: '/legal/terms',
} as const

/**
 * Страницы, доступные без входа (маршруты вне `RequireAuth` в App.tsx). На них 401 от API
 * не уводит на экран входа: иначе экран входа (он сам спрашивает `/me`) зациклился бы.
 * Новый публичный маршрут добавляется и сюда.
 */
export const publicPaths: readonly string[] = [
  paths.login,
  paths.register,
  paths.forgotPassword,
  paths.resetPassword,
  paths.verifyEmail,
  paths.legalPrivacy,
  paths.legalTerms,
]

/**
 * Публичная ли страница. Сравнение — тем же `matchPath`, которым роутер выбирает маршрут:
 * он, как и роутер, не различает регистр и принимает завершающий `/` (`/LOGIN`,
 * `/verify-email/`). Буквальное сравнение строк сочло бы такие адреса защищёнными,
 * и 401 от `/me` увёл бы со страницы подтверждения на вход.
 */
export function isPublicPath(pathname: string): boolean {
  return publicPaths.some((path) => matchPath({ path, caseSensitive: false, end: true }, pathname))
}

/** Адрес экрана входа, после которого пользователь вернётся на `next`. */
export function loginPath(next?: string): string {
  if (!next || next === paths.home) return paths.login
  return `${paths.login}?${new URLSearchParams({ next })}`
}

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
