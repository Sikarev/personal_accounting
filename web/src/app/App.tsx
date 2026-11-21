import { lazy } from 'react'
import { Route, Routes } from 'react-router'

import { RedirectIfAuthenticated, RequireAuth } from '../features/auth/RouteGuards'
import { AuthPage } from '../pages/auth/AuthPage'
import { ForgotPasswordPage } from '../pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from '../pages/auth/ResetPasswordPage'
import { VerifyEmailPage } from '../pages/auth/VerifyEmailPage'
import { HomePage } from '../pages/HomePage'
import { LegalPage } from '../pages/LegalPage'
import { MorePage } from '../pages/MorePage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { ReportsPage } from '../pages/ReportsPage'
import { SettingsPage } from '../pages/settings/SettingsPage'
import { TransactionsPage } from '../pages/TransactionsPage'
import { AppLayout } from './layout/AppLayout'
import { RouteBoundary } from './layout/RouteBoundary'
import { paths } from './navigation'

// Лёгкие экраны грузятся вместе с оболочкой. Тяжёлые — отдельным чанком по маршруту
// (React.lazy), чтобы не тратить бюджет JS первой загрузки (ux.md, раздел 8):
// «Счета» и «Категории» — с перетаскиванием (@dnd-kit) и формами, дальше — отчёты
// с графиками. Загрузку и ошибку загрузки чанка обрабатывает RouteBoundary — для всех
// ленивых экранов сразу, свой Suspense не нужен.
const AccountsPage = lazy(() =>
  import('../pages/accounts/AccountsPage').then((m) => ({ default: m.AccountsPage })),
)
const CategoriesPage = lazy(() =>
  import('../pages/settings/CategoriesPage').then((m) => ({ default: m.CategoriesPage })),
)

// Публичные страницы (вход, восстановление пароля, документы) — вне оболочки.
// Их список для обработки 401 — `isPublicPath` в navigation.ts; новый публичный маршрут
// добавляется и туда.
export function App() {
  return (
    <Routes>
      <Route element={<RedirectIfAuthenticated />}>
        <Route path={paths.login} element={<AuthPage mode="login" />} />
        <Route path={paths.register} element={<AuthPage mode="register" />} />
      </Route>
      <Route path={paths.forgotPassword} element={<ForgotPasswordPage />} />
      <Route path={paths.resetPassword} element={<ResetPasswordPage />} />
      <Route path={paths.verifyEmail} element={<VerifyEmailPage />} />
      <Route path={paths.legalPrivacy} element={<LegalPage doc="privacy" />} />
      <Route path={paths.legalTerms} element={<LegalPage doc="terms" />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          {/* Внутри оболочки: при ошибке загрузки экрана меню остаётся на месте. */}
          <Route element={<RouteBoundary />}>
            <Route path={paths.home} element={<HomePage />} />
            <Route path={paths.transactions} element={<TransactionsPage />} />
            <Route path={paths.reports} element={<ReportsPage />} />
            <Route path={paths.accounts} element={<AccountsPage />} />
            <Route path={paths.settings} element={<SettingsPage />} />
            <Route path={paths.settingsCategories} element={<CategoriesPage />} />
            <Route path={paths.more} element={<MorePage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}
