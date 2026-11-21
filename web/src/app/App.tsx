import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'

import { RedirectIfAuthenticated, RequireAuth } from '../features/auth/RouteGuards'
import { AccountsPage } from '../pages/AccountsPage'
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
import { paths } from './navigation'

// «Категории» — по маршруту (ux.md, раздел 8): перетаскивание (@dnd-kit) и выпадающие
// списки Mantine добавляли к первой загрузке ~57 КБ gzip, а экран открывают редко.
const CategoriesPage = lazy(() =>
  import('../pages/settings/CategoriesPage').then((m) => ({ default: m.CategoriesPage })),
)

// Экраны пока лёгкие и грузятся вместе с оболочкой. Тяжёлые (отчёты с графиками)
// подключим через React.lazy по маршруту — бюджет JS в ux.md, раздел 8.
//
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
          <Route path={paths.home} element={<HomePage />} />
          <Route path={paths.transactions} element={<TransactionsPage />} />
          <Route path={paths.reports} element={<ReportsPage />} />
          <Route path={paths.accounts} element={<AccountsPage />} />
          <Route path={paths.settings} element={<SettingsPage />} />
          <Route
            path={paths.settingsCategories}
            element={
              // Чанк грузится быстрее порога скелетона (300 мс) — заглушка не нужна.
              <Suspense fallback={null}>
                <CategoriesPage />
              </Suspense>
            }
          />
          <Route path={paths.more} element={<MorePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
