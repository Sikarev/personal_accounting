// Селекторы элементов, на которые экран категорий переводит фокус после действий,
// убирающих или переставляющих строку (иначе фокус уходит на BODY). Атрибуты `data-*`
// ставят сами компоненты: CategoryTree, ArchiveSection, кнопки «Добавить категорию».

/** Кнопка меню строки дерева. */
export const rowMenuSelector = (id: string) => `[data-category-menu="${id}"]`

/** Кнопка «Вернуть» строки архива. */
export const restoreSelector = (id: string) => `[data-restore-id="${id}"]`

/** Заголовок-переключатель «Архив (N)». */
export const archiveToggleSelector = '[data-archive-toggle]'

/** «Добавить категорию» (в заголовке, над деревом или в пустом состоянии). */
export const addCategorySelector = '[data-add-category]'
