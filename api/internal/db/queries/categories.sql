-- Категории семьи. Вставка набора по умолчанию при регистрации — CreateCategory
-- в auth.sql. Каждый запрос фильтрует по family_id из сессии.

-- name: LockFamilyCategories :exec
-- Блокировка категорий семьи до конца транзакции (advisory-lock — блокировка
-- по числу, не привязанная к строкам). Все изменения категорий одной семьи
-- выполняются по очереди: два одновременных перемещения не перемешают
-- перенумерацию соседей, а «в конец» при создании не выдаст двум категориям
-- одну позицию. Другие семьи и чтение не ждут. Ключ — хеш строки: совпадение
-- хешей двух семей лишь заставит их изредка подождать друг друга.
SELECT pg_advisory_xact_lock(hashtextextended('categories:' || sqlc.arg(family_id)::uuid::text, 0));

-- name: ListCategories :many
SELECT *
FROM categories
WHERE family_id = @family_id
ORDER BY kind, sort_order, created_at, id;

-- name: GetCategory :one
SELECT *
FROM categories
WHERE family_id = @family_id AND id = @id;

-- name: ListCategoryChildren :many
SELECT *
FROM categories
WHERE family_id = @family_id AND parent_id = @parent_id::uuid
ORDER BY sort_order, created_at, id;

-- name: CategoryHasChildren :one
SELECT EXISTS (
    SELECT 1 FROM categories
    WHERE family_id = @family_id AND parent_id = @parent_id::uuid
);

-- name: ListCategorySiblingIDs :many
-- Соседи — категории с тем же видом и родителем (NULL — верхний уровень),
-- в том же порядке, что и в ListCategories.
SELECT id
FROM categories
WHERE family_id = @family_id
  AND kind = @kind
  AND parent_id IS NOT DISTINCT FROM sqlc.narg('parent_id')::uuid
ORDER BY sort_order, created_at, id;

-- name: NextCategorySortOrder :one
SELECT (COALESCE(MAX(sort_order), 0) + 1)::integer
FROM categories
WHERE family_id = @family_id
  AND kind = @kind
  AND parent_id IS NOT DISTINCT FROM sqlc.narg('parent_id')::uuid;

-- name: InsertCategory :one
INSERT INTO categories (family_id, kind, parent_id, name, sort_order, created_at, updated_at)
VALUES (@family_id, @kind, @parent_id, @name, @sort_order, @now, @now)
RETURNING *;

-- name: RenameCategory :one
UPDATE categories
SET name = @name, updated_at = @now
WHERE family_id = @family_id AND id = @id
RETURNING *;

-- name: SetCategoryParent :exec
UPDATE categories
SET parent_id = @parent_id, updated_at = @now
WHERE family_id = @family_id AND id = @id;

-- name: RenumberCategories :exec
-- Позиции по порядку массива ids: первая получает 1. unnest … WITH ORDINALITY
-- разворачивает массив в строки (id, номер). Строки, позиция которых не
-- изменилась, не трогаем.
UPDATE categories c
SET sort_order = v.ord::integer, updated_at = @now
FROM unnest(@ids::uuid[]) WITH ORDINALITY AS v(id, ord)
WHERE c.family_id = @family_id
  AND c.id = v.id
  AND c.sort_order <> v.ord;

-- name: ArchiveCategoryTree :exec
-- Категория и её активные подкатегории получают один и тот же archived_at:
-- по нему разархивация потом найдёт, что было архивировано вместе.
UPDATE categories
SET archived_at = @now::timestamptz, updated_at = @now
WHERE family_id = @family_id
  AND (id = @id OR parent_id = @id)
  AND archived_at IS NULL;

-- name: UnarchiveCategoryTree :exec
-- Категория и подкатегории, архивированные вместе с ней (тот же archived_at).
-- Подкатегории, архивированные раньше отдельно, остаются в архиве.
UPDATE categories
SET archived_at = NULL, updated_at = @now
WHERE family_id = @family_id
  AND (id = @id OR (parent_id = @id AND archived_at = @archived_at::timestamptz));

-- name: UnarchiveCategory :exec
UPDATE categories
SET archived_at = NULL, updated_at = @now
WHERE family_id = @family_id AND id = @id AND archived_at IS NOT NULL;

-- name: ReassignCategoryTransactions :execrows
-- Перенос операций при слиянии — включая мягко удалённые: иначе внешний ключ
-- transactions → categories не даст удалить категорию.
UPDATE transactions
SET category_id = @target_id::uuid, updated_at = @now
WHERE family_id = @family_id AND category_id = ANY(@ids::uuid[]);

-- name: DeleteCategoryChildren :exec
DELETE FROM categories
WHERE family_id = @family_id AND parent_id = @parent_id::uuid;

-- name: DeleteCategory :exec
DELETE FROM categories
WHERE family_id = @family_id AND id = @id;

-- name: InsertAuditLog :exec
INSERT INTO audit_log (family_id, actor_user_id, entity_type, entity_id, action, before, after, created_at)
VALUES (@family_id, @actor_user_id, @entity_type, @entity_id, @action, @before, @after, @now);
