-- Участники семьи и роли. family_id — только из сессии (Principal).
-- Создание семьи и членства — CreateFamily и AddFamilyMember в auth.sql.

-- name: LockFamilyMembers :exec
-- Блокировка состава семьи до конца транзакции (advisory-lock, как у категорий).
-- Смена ролей, исключение и выход одной семьи идут по очереди, поэтому
-- проверка «останется ли владелец» и само изменение не разделяются чужим
-- изменением: два владельца, понижающие друг друга одновременно, не оставят
-- семью без владельца. Другие семьи и чтение не ждут.
SELECT pg_advisory_xact_lock(hashtextextended('family_members:' || sqlc.arg(family_id)::uuid::text, 0));

-- name: ListFamilyMembers :many
-- Владельцы первыми, затем по дате вступления; id — для устойчивого порядка.
SELECT fm.user_id, u.name, u.email, fm.role, fm.joined_at
FROM family_members fm
JOIN users u ON u.id = fm.user_id
WHERE fm.family_id = @family_id
ORDER BY (fm.role = 'owner') DESC, fm.joined_at, fm.user_id;

-- name: GetFamilyMember :one
SELECT fm.user_id, u.name, u.email, fm.role, fm.joined_at
FROM family_members fm
JOIN users u ON u.id = fm.user_id
WHERE fm.family_id = @family_id AND fm.user_id = @user_id;

-- name: CountFamilyMembers :one
-- Сколько участников и сколько из них владельцев.
SELECT count(*)::integer AS members,
       (count(*) FILTER (WHERE role = 'owner'))::integer AS owners
FROM family_members
WHERE family_id = @family_id;

-- name: SetFamilyMemberRole :exec
UPDATE family_members
SET role = @role
WHERE family_id = @family_id AND user_id = @user_id;

-- name: DeleteFamilyMember :exec
DELETE FROM family_members
WHERE family_id = @family_id AND user_id = @user_id;

-- name: ArchivePersonalAccounts :exec
-- Личные счета ушедшего участника остаются в семье и уходят в архив. Видеть их
-- больше некому: правило видимости пускает к личному счёту только владельца,
-- а он уже не участник этой семьи.
UPDATE accounts
SET archived_at = @now::timestamptz, updated_at = @now
WHERE family_id = @family_id AND owner_user_id = @user_id::uuid AND archived_at IS NULL;
