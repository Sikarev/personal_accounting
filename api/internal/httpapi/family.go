package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"personal-accounting/api/internal/db/dbgen"
	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/problem"
)

// auditEntityFamilyMember — entity_type записей журнала о составе семьи.
// entity_id — id пользователя. Смена роли — action update, исключение
// и выход — delete; выход отличается тем, что actor_user_id = entity_id.
const auditEntityFamilyMember = "family_member"

func (s *server) ListFamilyMembers(ctx context.Context, _ oapi.ListFamilyMembersRequestObject) (oapi.ListFamilyMembersResponseObject, error) {
	p := currentUser(ctx)
	rows, err := s.q.ListFamilyMembers(ctx, p.FamilyID)
	if err != nil {
		return nil, fmt.Errorf("list family members: %w", err)
	}
	items := make([]oapi.FamilyMember, 0, len(rows))
	for _, r := range rows {
		items = append(items, familyMemberOf(dbgen.GetFamilyMemberRow(r)))
	}
	return oapi.ListFamilyMembers200JSONResponse{Items: items}, nil
}

func (s *server) SetFamilyMemberRole(ctx context.Context, req oapi.SetFamilyMemberRoleRequestObject) (oapi.SetFamilyMemberRoleResponseObject, error) {
	p := currentUser(ctx)
	role := dbgen.FamilyRole(req.Body.Role)
	var result dbgen.GetFamilyMemberRow
	err := s.inFamilyTx(ctx, p.FamilyID, func(q *dbgen.Queries) error {
		if err := requireOwner(ctx, q, p); err != nil {
			return err
		}
		target, err := getFamilyMember(ctx, q, p.FamilyID, req.UserId)
		if err != nil {
			return err
		}
		result = target
		if target.Role == role {
			return nil // та же роль: ничего не меняем и не пишем в журнал
		}
		if target.Role == dbgen.FamilyRoleOwner {
			// Понизить можно только при другом владельце. Действующий — сам
			// владелец, поэтому сработает лишь при понижении себя, но правило
			// проверяем в общем виде.
			if err := requireOtherOwner(ctx, q, p.FamilyID); err != nil {
				return err
			}
		}
		if err := q.SetFamilyMemberRole(ctx, dbgen.SetFamilyMemberRoleParams{
			Role: role, FamilyID: p.FamilyID, UserID: target.UserID,
		}); err != nil {
			return fmt.Errorf("set family role: %w", err)
		}
		result.Role = role
		return s.writeMemberAudit(ctx, q, p.FamilyID, p.UserID, target.UserID, dbgen.AuditActionUpdate,
			&memberSnapshot{UserID: target.UserID, Role: target.Role},
			&memberSnapshot{UserID: target.UserID, Role: role})
	})
	if err != nil {
		return nil, err
	}
	return oapi.SetFamilyMemberRole200JSONResponse(familyMemberOf(result)), nil
}

func (s *server) RemoveFamilyMember(ctx context.Context, req oapi.RemoveFamilyMemberRequestObject) (oapi.RemoveFamilyMemberResponseObject, error) {
	p := currentUser(ctx)
	err := s.inFamilyTx(ctx, p.FamilyID, func(q *dbgen.Queries) error {
		if err := requireOwner(ctx, q, p); err != nil {
			return err
		}
		if req.UserId == p.UserID {
			return problem.Conflict(problem.CodeCannotRemoveSelf, "Себя нельзя исключить — можно покинуть семью.")
		}
		target, err := getFamilyMember(ctx, q, p.FamilyID, req.UserId)
		if err != nil {
			return err
		}
		// Владелец-инициатор остаётся в семье, поэтому без владельца она не останется.
		_, err = s.departFamily(ctx, q, p.FamilyID, target, p.UserID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return oapi.RemoveFamilyMember204Response{}, nil
}

func (s *server) LeaveFamily(ctx context.Context, _ oapi.LeaveFamilyRequestObject) (oapi.LeaveFamilyResponseObject, error) {
	p := currentUser(ctx)
	var newFamilyID uuid.UUID
	err := s.inFamilyTx(ctx, p.FamilyID, func(q *dbgen.Queries) error {
		// Членство перечитываем под блокировкой: роль из сессии могла
		// измениться, пока запрос ждал очереди.
		self, err := getFamilyMember(ctx, q, p.FamilyID, p.UserID)
		if err != nil {
			return err
		}
		counts, err := q.CountFamilyMembers(ctx, p.FamilyID)
		if err != nil {
			return fmt.Errorf("count family members: %w", err)
		}
		if counts.Members <= 1 {
			return problem.Conflict(problem.CodeSoleMember, "Вы единственный участник семьи — выходить некуда.")
		}
		if self.Role == dbgen.FamilyRoleOwner && counts.Owners <= 1 {
			return problem.Conflict(problem.CodeLastOwner, "Вы единственный владелец: сначала назначьте другого владельца.")
		}
		newFamilyID, err = s.departFamily(ctx, q, p.FamilyID, self, p.UserID)
		return err
	})
	if err != nil {
		return nil, err
	}
	me, err := s.me(ctx, p.UserID, newFamilyID)
	if err != nil {
		return nil, err
	}
	return oapi.LeaveFamily200JSONResponse(me), nil
}

// inFamilyTx выполняет fn в транзакции под блокировкой состава семьи
// (LockFamilyMembers в family.sql): проверки инвариантов («останется ли
// владелец») и изменения ролей и состава одной семьи идут по очереди.
func (s *server) inFamilyTx(ctx context.Context, familyID uuid.UUID, fn func(q *dbgen.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := q.LockFamilyMembers(ctx, familyID); err != nil {
		return fmt.Errorf("lock family members: %w", err)
	}
	if err := fn(q); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// requireOwner проверяет роль действующего пользователя по БД под блокировкой,
// а не по сессии: два владельца, одновременно понижающие друг друга, иначе
// оба прошли бы проверку по ролям, прочитанным до ожидания блокировки.
func requireOwner(ctx context.Context, q *dbgen.Queries, p Principal) error {
	m, err := q.GetMembership(ctx, p.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return problem.Forbidden(problem.CodeNotOwner, "Действие доступно только владельцу семьи.")
	}
	if err != nil {
		return fmt.Errorf("get membership: %w", err)
	}
	if m.FamilyID != p.FamilyID || m.Role != dbgen.FamilyRoleOwner {
		return problem.Forbidden(problem.CodeNotOwner, "Действие доступно только владельцу семьи.")
	}
	return nil
}

// requireOtherOwner — в семье больше одного владельца (один из них уходит
// или теряет роль).
func requireOtherOwner(ctx context.Context, q *dbgen.Queries, familyID uuid.UUID) error {
	counts, err := q.CountFamilyMembers(ctx, familyID)
	if err != nil {
		return fmt.Errorf("count family members: %w", err)
	}
	if counts.Owners <= 1 {
		return problem.Conflict(problem.CodeLastOwner, "В семье должен остаться хотя бы один владелец.")
	}
	return nil
}

// getFamilyMember ищет участника семьи; пользователь другой семьи
// и несуществующий — одинаково 404.
func getFamilyMember(ctx context.Context, q *dbgen.Queries, familyID, userID uuid.UUID) (dbgen.GetFamilyMemberRow, error) {
	m, err := q.GetFamilyMember(ctx, dbgen.GetFamilyMemberParams{FamilyID: familyID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return m, problem.NotFound("Участник не найден.")
	}
	if err != nil {
		return m, fmt.Errorf("get family member: %w", err)
	}
	return m, nil
}

// departFamily — общая часть выхода и исключения (решение Q2): участник
// покидает семью, его личные счета остаются в ней в архиве (их больше никто
// не видит), ему создаётся новая семья. Операции на общих счетах и переводы
// «личный ↔ общий» не меняются: оставшиеся видят общую сторону с counterparty,
// а править такой перевод больше некому (transaction_readonly).
// Вызывается под блокировкой состава семьи; возвращает id новой семьи.
func (s *server) departFamily(ctx context.Context, q *dbgen.Queries, familyID uuid.UUID,
	member dbgen.GetFamilyMemberRow, actorID uuid.UUID,
) (uuid.UUID, error) {
	if err := q.DeleteFamilyMember(ctx, dbgen.DeleteFamilyMemberParams{FamilyID: familyID, UserID: member.UserID}); err != nil {
		return uuid.Nil, fmt.Errorf("delete family member: %w", err)
	}
	if err := q.ArchivePersonalAccounts(ctx, dbgen.ArchivePersonalAccountsParams{
		Now: s.now(), FamilyID: familyID, UserID: member.UserID,
	}); err != nil {
		return uuid.Nil, fmt.Errorf("archive personal accounts: %w", err)
	}
	if err := s.writeMemberAudit(ctx, q, familyID, actorID, member.UserID, dbgen.AuditActionDelete,
		&memberSnapshot{UserID: member.UserID, Role: member.Role}, nil); err != nil {
		return uuid.Nil, err
	}
	return createOwnFamily(ctx, q, member.UserID)
}

// createOwnFamily создаёт пользователю семью «Семья», где он owner,
// с категориями по умолчанию. Общая для регистрации и выхода из семьи.
func createOwnFamily(ctx context.Context, q *dbgen.Queries, userID uuid.UUID) (uuid.UUID, error) {
	familyID, err := q.CreateFamily(ctx, defaultFamilyName)
	if err != nil {
		return uuid.Nil, fmt.Errorf("create family: %w", err)
	}
	if err := q.AddFamilyMember(ctx, dbgen.AddFamilyMemberParams{
		FamilyID: familyID, UserID: userID, Role: dbgen.FamilyRoleOwner,
	}); err != nil {
		return uuid.Nil, fmt.Errorf("add family owner: %w", err)
	}
	if err := createDefaultCategories(ctx, q, familyID); err != nil {
		return uuid.Nil, err
	}
	return familyID, nil
}

// memberSnapshot — состояние участника для audit_log.before/after.
type memberSnapshot struct {
	UserID uuid.UUID        `json:"userId"`
	Role   dbgen.FamilyRole `json:"role"`
}

func (s *server) writeMemberAudit(ctx context.Context, q *dbgen.Queries, familyID, actorID, userID uuid.UUID,
	action dbgen.AuditAction, before, after *memberSnapshot,
) error {
	// marshal возвращает nil для nil-снимка — в журнале будет NULL.
	marshal := func(m *memberSnapshot) ([]byte, error) {
		if m == nil {
			return nil, nil
		}
		return json.Marshal(m)
	}
	b, err := marshal(before)
	if err != nil {
		return err
	}
	a, err := marshal(after)
	if err != nil {
		return err
	}
	if err := q.InsertAuditLog(ctx, dbgen.InsertAuditLogParams{
		FamilyID: familyID, ActorUserID: &actorID, EntityType: auditEntityFamilyMember, EntityID: userID,
		Action: action, Before: b, After: a, Now: s.now(),
	}); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func familyMemberOf(r dbgen.GetFamilyMemberRow) oapi.FamilyMember {
	return oapi.FamilyMember{
		UserId:   r.UserID,
		Name:     r.Name,
		Email:    r.Email,
		Role:     oapi.FamilyRole(r.Role),
		JoinedAt: r.JoinedAt.UTC(), // в UTC, а не в поясе сервера (ср. техдолг №33)
	}
}
