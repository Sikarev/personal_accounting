package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"personal-accounting/api/internal/db/dbgen"
	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/problem"
)

const (
	// categoryNameMaxLen — длина имени после обрезки пробелов (в символах).
	// В контракте maxLength больше: там длина до обрезки.
	categoryNameMaxLen = 60
	// categoriesNameKey — уникальный индекс имени среди соседей (00001_init.sql).
	categoriesNameKey = "categories_name_key"
)

// Ошибки правил категорий. Функции, а не переменные: *problem.Problem —
// изменяемый указатель, общий экземпляр на все запросы делить нельзя.
func errCategoryNotFound() *problem.Problem {
	return problem.NotFound("Категория не найдена.")
}

// errInvalidParent — родитель не подходит. Родитель чужой семьи и
// несуществующий дают один и тот же ответ: факт существования не раскрывается.
func errInvalidParent() *problem.Problem {
	return problem.Validation(problem.FieldError{
		Field: "parentId", Code: "invalid_parent", Message: "Эту категорию нельзя выбрать родителем.",
	})
}

func errNameTaken(field string) *problem.Problem {
	return problem.Validation(problem.FieldError{
		Field: field, Code: "name_taken", Message: "Категория с таким названием здесь уже есть.",
	})
}

func errInvalidTarget() *problem.Problem {
	return problem.Validation(problem.FieldError{
		Field: "targetId", Code: "invalid_target", Message: "В эту категорию нельзя перенести операции.",
	})
}

// categoryName обрезает пробелы и проверяет имя. Длину до обрезки и наличие
// поля уже проверил валидатор контракта.
func categoryName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	switch {
	case name == "":
		return "", problem.Validation(problem.FieldError{Field: "name", Code: "required", Message: "Укажите название."})
	case utf8.RuneCountInString(name) > categoryNameMaxLen:
		return "", problem.Validation(problem.FieldError{Field: "name", Code: "too_long", Message: "Не длиннее 60 символов."})
	case hasControlChars(name):
		return "", problem.Validation(problem.FieldError{Field: "name", Code: "invalid_format", Message: "Название содержит недопустимые символы."})
	}
	return name, nil
}

func categoryToAPI(c dbgen.Category) oapi.Category {
	return oapi.Category{
		Id:         c.ID,
		Kind:       oapi.CategoryKind(c.Kind),
		ParentId:   c.ParentID,
		Name:       c.Name,
		SortOrder:  int(c.SortOrder),
		ArchivedAt: c.ArchivedAt,
	}
}

// inCategoryTx выполняет fn в транзакции под блокировкой категорий семьи
// (см. LockFamilyCategories в categories.sql): все изменения категорий одной
// семьи идут по очереди, перенумерация соседей не перемешивается.
func (s *server) inCategoryTx(ctx context.Context, familyID uuid.UUID, fn func(q *dbgen.Queries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := q.LockFamilyCategories(ctx, familyID); err != nil {
		return fmt.Errorf("lock categories: %w", err)
	}
	if err := fn(q); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// getCategory ищет категорию семьи; нет (или чужая) — notFound.
func getCategory(ctx context.Context, q *dbgen.Queries, familyID, id uuid.UUID, notFound func() *problem.Problem) (dbgen.Category, error) {
	c, err := q.GetCategory(ctx, dbgen.GetCategoryParams{FamilyID: familyID, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		return c, notFound()
	}
	if err != nil {
		return c, fmt.Errorf("get category: %w", err)
	}
	return c, nil
}

func (s *server) ListCategories(ctx context.Context, _ oapi.ListCategoriesRequestObject) (oapi.ListCategoriesResponseObject, error) {
	p := currentUser(ctx)
	rows, err := s.q.ListCategories(ctx, p.FamilyID)
	if err != nil {
		return nil, fmt.Errorf("list categories: %w", err)
	}
	items := make([]oapi.Category, 0, len(rows))
	for _, c := range rows {
		items = append(items, categoryToAPI(c))
	}
	return oapi.ListCategories200JSONResponse{Items: items}, nil
}

func (s *server) CreateCategory(ctx context.Context, req oapi.CreateCategoryRequestObject) (oapi.CreateCategoryResponseObject, error) {
	p := currentUser(ctx)
	b := req.Body
	name, err := categoryName(b.Name)
	if err != nil {
		return nil, err
	}
	kind := dbgen.CategoryKind(b.Kind)

	var created dbgen.Category
	err = s.inCategoryTx(ctx, p.FamilyID, func(q *dbgen.Queries) error {
		if b.ParentId != nil {
			parent, err := getCategory(ctx, q, p.FamilyID, *b.ParentId, errInvalidParent)
			if err != nil {
				return err
			}
			// Глубина ≤ 2: родитель сам должен быть верхнего уровня.
			if parent.Kind != kind || parent.ParentID != nil || parent.ArchivedAt != nil {
				return errInvalidParent()
			}
		}
		order, err := q.NextCategorySortOrder(ctx, dbgen.NextCategorySortOrderParams{
			FamilyID: p.FamilyID, Kind: kind, ParentID: b.ParentId,
		})
		if err != nil {
			return fmt.Errorf("next sort order: %w", err)
		}
		created, err = q.InsertCategory(ctx, dbgen.InsertCategoryParams{
			FamilyID: p.FamilyID, Kind: kind, ParentID: b.ParentId, Name: name, SortOrder: order, Now: s.now(),
		})
		if isUniqueViolation(err, categoriesNameKey) {
			return errNameTaken("name")
		}
		if err != nil {
			return fmt.Errorf("insert category: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return oapi.CreateCategory201JSONResponse(categoryToAPI(created)), nil
}

func (s *server) UpdateCategory(ctx context.Context, req oapi.UpdateCategoryRequestObject) (oapi.UpdateCategoryResponseObject, error) {
	p := currentUser(ctx)
	name, err := categoryName(req.Body.Name)
	if err != nil {
		return nil, err
	}
	// Одиночный UPDATE: позиции не меняются, блокировка не нужна. Гонку двух
	// одинаковых имён разрешает уникальный индекс.
	c, err := s.q.RenameCategory(ctx, dbgen.RenameCategoryParams{
		Name: name, Now: s.now(), FamilyID: p.FamilyID, ID: req.CategoryId,
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil, errCategoryNotFound()
	case isUniqueViolation(err, categoriesNameKey):
		return nil, errNameTaken("name")
	case err != nil:
		return nil, fmt.Errorf("rename category: %w", err)
	}
	return oapi.UpdateCategory200JSONResponse(categoryToAPI(c)), nil
}

func (s *server) MoveCategory(ctx context.Context, req oapi.MoveCategoryRequestObject) (oapi.MoveCategoryResponseObject, error) {
	p := currentUser(ctx)
	newParent := req.Body.ParentId
	index := req.Body.Index

	var moved dbgen.Category
	err := s.inCategoryTx(ctx, p.FamilyID, func(q *dbgen.Queries) error {
		c, err := getCategory(ctx, q, p.FamilyID, req.CategoryId, errCategoryNotFound)
		if err != nil {
			return err
		}
		parentChanged := !equalUUIDPtr(c.ParentID, newParent)
		if newParent != nil {
			if *newParent == c.ID {
				return errInvalidParent()
			}
			parent, err := getCategory(ctx, q, p.FamilyID, *newParent, errInvalidParent)
			if err != nil {
				return err
			}
			// Вид категории не меняется; глубина ≤ 2. В архивного родителя
			// переносить нельзя (активная подкатегория под архивным родителем
			// пропала бы из интерфейса), но переставлять внутри него — можно.
			if parent.Kind != c.Kind || parent.ParentID != nil || (parentChanged && parent.ArchivedAt != nil) {
				return errInvalidParent()
			}
			hasChildren, err := q.CategoryHasChildren(ctx, dbgen.CategoryHasChildrenParams{FamilyID: p.FamilyID, ParentID: c.ID})
			if err != nil {
				return fmt.Errorf("category has children: %w", err)
			}
			if hasChildren {
				return problem.Validation(problem.FieldError{
					Field: "parentId", Code: "has_children", Message: "Категорию с подкатегориями нельзя вложить в другую.",
				})
			}
		}

		now := s.now()
		if parentChanged {
			err := q.SetCategoryParent(ctx, dbgen.SetCategoryParentParams{
				ParentID: newParent, Now: now, FamilyID: p.FamilyID, ID: c.ID,
			})
			// Поле parentId, а не name: имя в запросе не передаётся, конфликт
			// возникает из-за выбранного родителя.
			if isUniqueViolation(err, categoriesNameKey) {
				return errNameTaken("parentId")
			}
			if err != nil {
				return fmt.Errorf("set category parent: %w", err)
			}
			// Старые соседи: закрываем пропуск на месте ушедшей категории.
			if err := renumberSiblings(ctx, q, p.FamilyID, c.Kind, c.ParentID, now, func(ids []uuid.UUID) []uuid.UUID { return ids }); err != nil {
				return err
			}
		}
		// Новые соседи: ставим категорию на позицию index.
		err = renumberSiblings(ctx, q, p.FamilyID, c.Kind, newParent, now, func(ids []uuid.UUID) []uuid.UUID {
			ids = slices.DeleteFunc(ids, func(id uuid.UUID) bool { return id == c.ID })
			return slices.Insert(ids, min(index, len(ids)), c.ID)
		})
		if err != nil {
			return err
		}
		moved, err = getCategory(ctx, q, p.FamilyID, c.ID, errCategoryNotFound)
		return err
	})
	if err != nil {
		return nil, err
	}
	return oapi.MoveCategory200JSONResponse(categoryToAPI(moved)), nil
}

// renumberSiblings читает соседей (вид + родитель) в текущем порядке,
// даёт order переставить их и записывает позиции 1..n.
func renumberSiblings(ctx context.Context, q *dbgen.Queries, familyID uuid.UUID, kind dbgen.CategoryKind,
	parentID *uuid.UUID, now time.Time, order func([]uuid.UUID) []uuid.UUID,
) error {
	ids, err := q.ListCategorySiblingIDs(ctx, dbgen.ListCategorySiblingIDsParams{FamilyID: familyID, Kind: kind, ParentID: parentID})
	if err != nil {
		return fmt.Errorf("list category siblings: %w", err)
	}
	if err := q.RenumberCategories(ctx, dbgen.RenumberCategoriesParams{Now: now, FamilyID: familyID, Ids: order(ids)}); err != nil {
		return fmt.Errorf("renumber categories: %w", err)
	}
	return nil
}

func equalUUIDPtr(a, b *uuid.UUID) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func (s *server) ArchiveCategory(ctx context.Context, req oapi.ArchiveCategoryRequestObject) (oapi.ArchiveCategoryResponseObject, error) {
	p := currentUser(ctx)
	var res dbgen.Category
	err := s.inCategoryTx(ctx, p.FamilyID, func(q *dbgen.Queries) error {
		c, err := getCategory(ctx, q, p.FamilyID, req.CategoryId, errCategoryNotFound)
		if err != nil {
			return err
		}
		// Уже в архиве — ничего не меняем: повторный запрос не должен сдвинуть
		// archived_at, иначе разархивация не узнает подкатегории, ушедшие вместе.
		if c.ArchivedAt == nil {
			if err := q.ArchiveCategoryTree(ctx, dbgen.ArchiveCategoryTreeParams{Now: s.now(), FamilyID: p.FamilyID, ID: c.ID}); err != nil {
				return fmt.Errorf("archive category: %w", err)
			}
		}
		res, err = getCategory(ctx, q, p.FamilyID, c.ID, errCategoryNotFound)
		return err
	})
	if err != nil {
		return nil, err
	}
	return oapi.ArchiveCategory200JSONResponse(categoryToAPI(res)), nil
}

func (s *server) UnarchiveCategory(ctx context.Context, req oapi.UnarchiveCategoryRequestObject) (oapi.UnarchiveCategoryResponseObject, error) {
	p := currentUser(ctx)
	var res dbgen.Category
	err := s.inCategoryTx(ctx, p.FamilyID, func(q *dbgen.Queries) error {
		c, err := getCategory(ctx, q, p.FamilyID, req.CategoryId, errCategoryNotFound)
		if err != nil {
			return err
		}
		now := s.now()
		if c.ParentID == nil {
			// Верхний уровень: вместе с ним — подкатегории с тем же archived_at.
			if c.ArchivedAt != nil {
				err := q.UnarchiveCategoryTree(ctx, dbgen.UnarchiveCategoryTreeParams{
					Now: now, FamilyID: p.FamilyID, ID: c.ID, ArchivedAt: *c.ArchivedAt,
				})
				if err != nil {
					return fmt.Errorf("unarchive category tree: %w", err)
				}
			}
		} else {
			// Подкатегория: она сама и (если в архиве) её родитель — без его
			// остальных подкатегорий. Иначе подкатегория осталась бы под
			// архивным родителем и не была бы видна.
			for _, id := range []uuid.UUID{c.ID, *c.ParentID} {
				if err := q.UnarchiveCategory(ctx, dbgen.UnarchiveCategoryParams{Now: now, FamilyID: p.FamilyID, ID: id}); err != nil {
					return fmt.Errorf("unarchive category: %w", err)
				}
			}
		}
		res, err = getCategory(ctx, q, p.FamilyID, c.ID, errCategoryNotFound)
		return err
	})
	if err != nil {
		return nil, err
	}
	return oapi.UnarchiveCategory200JSONResponse(categoryToAPI(res)), nil
}

// categorySnapshot — состояние удалённой категории для audit_log.before.
// Встроенная структура: её поля попадают в JSON на верхний уровень.
type categorySnapshot struct {
	oapi.Category
	Children []oapi.Category `json:"children"`
}

func (s *server) MergeCategory(ctx context.Context, req oapi.MergeCategoryRequestObject) (oapi.MergeCategoryResponseObject, error) {
	p := currentUser(ctx)
	targetID := req.Body.TargetId
	err := s.inCategoryTx(ctx, p.FamilyID, func(q *dbgen.Queries) error {
		src, err := getCategory(ctx, q, p.FamilyID, req.CategoryId, errCategoryNotFound)
		if err != nil {
			return err
		}
		// Цель чужой семьи и несуществующая — один ответ (422), как у parentId.
		target, err := getCategory(ctx, q, p.FamilyID, targetID, errInvalidTarget)
		if err != nil {
			return err
		}
		if target.ID == src.ID || target.Kind != src.Kind || target.ArchivedAt != nil ||
			equalUUIDPtr(target.ParentID, &src.ID) {
			return errInvalidTarget()
		}

		children, err := q.ListCategoryChildren(ctx, dbgen.ListCategoryChildrenParams{FamilyID: p.FamilyID, ParentID: src.ID})
		if err != nil {
			return fmt.Errorf("list category children: %w", err)
		}
		snapshot := categorySnapshot{Category: categoryToAPI(src), Children: make([]oapi.Category, 0, len(children))}
		ids := []uuid.UUID{src.ID}
		for _, ch := range children {
			snapshot.Children = append(snapshot.Children, categoryToAPI(ch))
			ids = append(ids, ch.ID)
		}

		now := s.now()
		if _, err := q.ReassignCategoryTransactions(ctx, dbgen.ReassignCategoryTransactionsParams{
			TargetID: target.ID, Now: now, FamilyID: p.FamilyID, Ids: ids,
		}); err != nil {
			return fmt.Errorf("reassign transactions: %w", err)
		}
		// Сначала подкатегории: внешний ключ parent_id не даст удалить родителя раньше.
		if err := q.DeleteCategoryChildren(ctx, dbgen.DeleteCategoryChildrenParams{FamilyID: p.FamilyID, ParentID: src.ID}); err != nil {
			return fmt.Errorf("delete category children: %w", err)
		}
		if err := q.DeleteCategory(ctx, dbgen.DeleteCategoryParams{FamilyID: p.FamilyID, ID: src.ID}); err != nil {
			return fmt.Errorf("delete category: %w", err)
		}

		// Одна запись на слияние; по перенесённым операциям записей нет
		// (см. docs/data-model.md → «Журнал изменений»).
		before, err := json.Marshal(snapshot)
		if err != nil {
			return err
		}
		after, err := json.Marshal(map[string]uuid.UUID{"mergedInto": target.ID})
		if err != nil {
			return err
		}
		actor := p.UserID
		if err := q.InsertAuditLog(ctx, dbgen.InsertAuditLogParams{
			FamilyID: p.FamilyID, ActorUserID: &actor, EntityType: "category", EntityID: src.ID,
			Action: dbgen.AuditActionDelete, Before: before, After: after, Now: now,
		}); err != nil {
			return fmt.Errorf("insert audit log: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return oapi.MergeCategory204Response{}, nil
}
