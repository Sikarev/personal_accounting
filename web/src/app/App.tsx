import { Route, Routes } from 'react-router'

import { AccountsPage } from '../pages/AccountsPage'
import { HomePage } from '../pages/HomePage'
import { MorePage } from '../pages/MorePage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { ReportsPage } from '../pages/ReportsPage'
import { SettingsPage } from '../pages/SettingsPage'
import { TransactionsPage } from '../pages/TransactionsPage'
import { AppLayout } from './layout/AppLayout'
import { paths } from './navigation'

// Экраны пока лёгкие и грузятся вместе с оболочкой. Тяжёлые (отчёты с графиками)
// подключим через React.lazy по маршруту — бюджет JS в ux.md, раздел 8.
export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path={paths.home} element={<HomePage />} />
        <Route path={paths.transactions} element={<TransactionsPage />} />
        <Route path={paths.reports} element={<ReportsPage />} />
        <Route path={paths.accounts} element={<AccountsPage />} />
        <Route path={paths.settings} element={<SettingsPage />} />
        <Route path={paths.more} element={<MorePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
