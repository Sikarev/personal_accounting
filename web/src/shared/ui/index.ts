// Базовые компоненты интерфейса. Каждый показан во всех состояниях в Storybook (*.stories.tsx).
export { AuthLayout, type AuthLayoutProps } from './AuthLayout/AuthLayout'
export { EmptyState, type EmptyStateProps } from './EmptyState/EmptyState'
export { Money, type MoneyProps, type MoneyVariant } from './Money/Money'
export { notifyWithUndo, type NotifyWithUndoOptions } from './notifyWithUndo/notifyWithUndo'
export { PageHeader, type PageHeaderProps } from './PageHeader/PageHeader'
export { PasswordField, type PasswordFieldProps } from './PasswordField/PasswordField'
export { ResponsiveSheet, type ResponsiveSheetProps } from './ResponsiveSheet/ResponsiveSheet'
export {
  TransactionListSkeleton,
  type TransactionListSkeletonProps,
} from './Skeletons/TransactionListSkeleton'
// CategoryPicker намеренно не экспортируется отсюда: импорт по пути
// ('shared/ui/CategoryPicker/CategoryPicker'). Модуль со стилями (CSS-модуль) сборщик
// не выбрасывает, и через этот файл Select/Combobox Mantine попадали бы в первую
// загрузку (+13 КБ gzip), хотя пикер нужен только на лениво загружаемых экранах.
