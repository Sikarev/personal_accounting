package httpapi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"personal-accounting/api/internal/db/dbgen"
	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/problem"
)

// foreignKeyViolation — SQLSTATE нарушения внешнего ключа.
const foreignKeyViolation = "23503"

// Значения видимости. Свои константы, а не сгенерированные: oapi-codegen
// называет значения enum коротко (oapi.Private), пока имена не совпали с
// другим enum, а при совпадении добавляет префикс — имя может поменяться
// от правки чужой схемы.
const (
	visibilityShared  = oapi.AccountVisibility("shared")
	visibilityPrivate = oapi.AccountVisibility("private")
)

// errAccountNotFound — ответ на любой невидимый счёт: чужой семьи, чужой
// личный или несуществующий. Причина не уточняется, чтобы не раскрывать,
// что такой счёт есть.
func errAccountNotFound() *problem.Problem { return problem.NotFound("Счёт не найден.") }

func (s *server) ListAccounts(ctx context.Context, _ oapi.ListAccountsRequestObject) (oapi.ListAccountsResponseObject, error) {
	p := currentUser(ctx)
	rows, err := s.q.ListAccounts(ctx, dbgen.ListAccountsParams{FamilyID: p.FamilyID, UserID: p.UserID})
	if err != nil {
		return nil, fmt.Errorf("list accounts: %w", err)
	}
	items := make([]oapi.Account, 0, len(rows))
	for _, row := range rows {
		items = append(items, accountFromRow(row))
	}
	return oapi.ListAccounts200JSONResponse{Items: items}, nil
}

func (s *server) CreateAccount(ctx context.Context, req oapi.CreateAccountRequestObject) (oapi.CreateAccountResponseObject, error) {
	p := currentUser(ctx)
	b := req.Body
	name, err := accountName(b.Name)
	if err != nil {
		return nil, err
	}

	var owner *uuid.UUID
	if b.Visibility == visibilityPrivate {
		owner = &p.UserID
	}
	includeInTotal := true
	if b.IncludeInTotal != nil {
		includeInTotal = *b.IncludeInTotal
	}
	var initialBalance int64
	if b.InitialBalance != nil {
		initialBalance = *b.InitialBalance
	}

	id, err := s.q.CreateAccount(ctx, dbgen.CreateAccountParams{
		FamilyID:       p.FamilyID,
		OwnerUserID:    owner,
		Name:           name,
		Type:           dbgen.AccountType(b.Type),
		InitialBalance: initialBalance,
		IncludeInTotal: includeInTotal,
		Color:          colorToDB(b.Color),
		Now:            s.now(),
		CurrencyCode:   b.Currency,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// INSERT ... SELECT не вставил строку: валюты нет или она не активна.
		return nil, problem.Validation(problem.FieldError{
			Field: "currency", Code: "invalid_value", Message: "Валюта недоступна для новых счетов.",
		})
	}
	if err != nil {
		return nil, fmt.Errorf("create account: %w", err)
	}
	acc, err := s.getAccount(ctx, s.q, p, id)
	if err != nil {
		return nil, err
	}
	return oapi.CreateAccount201JSONResponse(acc), nil
}

func (s *server) UpdateAccount(ctx context.Context, req oapi.UpdateAccountRequestObject) (oapi.UpdateAccountResponseObject, error) {
	p := currentUser(ctx)
	b := req.Body
	name, err := accountName(b.Name)
	if err != nil {
		return nil, err
	}
	id, err := s.q.UpdateAccount(ctx, dbgen.UpdateAccountParams{
		Name:           name,
		Type:           dbgen.AccountType(b.Type),
		InitialBalance: b.InitialBalance,
		IncludeInTotal: b.IncludeInTotal,
		Color:          colorToDB(b.Color),
		Now:            s.now(),
		ID:             req.AccountId,
		FamilyID:       p.FamilyID,
		UserID:         p.UserID,
	})
	if err := accountErr(err, "update account"); err != nil {
		return nil, err
	}
	acc, err := s.getAccount(ctx, s.q, p, id)
	if err != nil {
		return nil, err
	}
	return oapi.UpdateAccount200JSONResponse(acc), nil
}

func (s *server) ArchiveAccount(ctx context.Context, req oapi.ArchiveAccountRequestObject) (oapi.ArchiveAccountResponseObject, error) {
	p := currentUser(ctx)
	id, err := s.q.ArchiveAccount(ctx, dbgen.ArchiveAccountParams{
		Now: s.now(), ID: req.AccountId, FamilyID: p.FamilyID, UserID: p.UserID,
	})
	if err := accountErr(err, "archive account"); err != nil {
		return nil, err
	}
	acc, err := s.getAccount(ctx, s.q, p, id)
	if err != nil {
		return nil, err
	}
	return oapi.ArchiveAccount200JSONResponse(acc), nil
}

func (s *server) UnarchiveAccount(ctx context.Context, req oapi.UnarchiveAccountRequestObject) (oapi.UnarchiveAccountResponseObject, error) {
	p := currentUser(ctx)
	id, err := s.q.UnarchiveAccount(ctx, dbgen.UnarchiveAccountParams{
		Now: s.now(), ID: req.AccountId, FamilyID: p.FamilyID, UserID: p.UserID,
	})
	if err := accountErr(err, "unarchive account"); err != nil {
		return nil, err
	}
	acc, err := s.getAccount(ctx, s.q, p, id)
	if err != nil {
		return nil, err
	}
	return oapi.UnarchiveAccount200JSONResponse(acc), nil
}

func (s *server) DeleteAccount(ctx context.Context, req oapi.DeleteAccountRequestObject) (oapi.DeleteAccountResponseObject, error) {
	p := currentUser(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	// Блокировка не даёт добавить операцию по счёту между проверкой и удалением.
	_, err = q.LockAccount(ctx, dbgen.LockAccountParams{ID: req.AccountId, FamilyID: p.FamilyID, UserID: p.UserID})
	if err := accountErr(err, "lock account"); err != nil {
		return nil, err
	}
	has, err := q.AccountHasTransactions(ctx, dbgen.AccountHasTransactionsParams{FamilyID: p.FamilyID, AccountID: req.AccountId})
	if err != nil {
		return nil, fmt.Errorf("account has transactions: %w", err)
	}
	if has {
		return nil, errAccountHasTransactions()
	}
	err = q.DeleteAccount(ctx, dbgen.DeleteAccountParams{ID: req.AccountId, FamilyID: p.FamilyID, UserID: p.UserID})
	// Подстраховка: если операция всё-таки сослалась на счёт, БД не даст удалить
	// его по внешнему ключу — это тот же конфликт, а не 500.
	if isForeignKeyViolation(err) {
		return nil, errAccountHasTransactions()
	}
	if err != nil {
		return nil, fmt.Errorf("delete account: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit delete account: %w", err)
	}
	return oapi.DeleteAccount204Response{}, nil
}

func (s *server) ReorderAccounts(ctx context.Context, req oapi.ReorderAccountsRequestObject) (oapi.ReorderAccountsResponseObject, error) {
	p := currentUser(ctx)
	ids := req.Body.AccountIds // уникальность и 1–500 элементов проверил валидатор контракта

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	n, err := s.q.WithTx(tx).ReorderAccounts(ctx, dbgen.ReorderAccountsParams{
		Ids: ids, Now: s.now(), FamilyID: p.FamilyID, UserID: p.UserID,
	})
	if err != nil {
		return nil, fmt.Errorf("reorder accounts: %w", err)
	}
	if n != int64(len(ids)) {
		// Какой-то id не найден среди видимых счетов семьи. Какой именно —
		// не сообщаем; defer откатит уже сделанные изменения.
		return nil, errAccountNotFound()
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit reorder accounts: %w", err)
	}
	return oapi.ReorderAccounts204Response{}, nil
}

func (s *server) AdjustAccountBalance(ctx context.Context, req oapi.AdjustAccountBalanceRequestObject) (oapi.AdjustAccountBalanceResponseObject, error) {
	p := currentUser(ctx)
	now := s.now()

	tz, err := s.q.GetUserTimezone(ctx, p.UserID)
	if err != nil {
		return nil, fmt.Errorf("get user timezone: %w", err)
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		// Пояс проверяется при регистрации, сюда попасть не должны.
		return nil, fmt.Errorf("load user timezone %q: %w", tz, err)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	// Блокировка счёта — до чтения остатка: иначе две одновременные
	// корректировки посчитали бы разницу от одного и того же остатка.
	locked, err := q.LockAccount(ctx, dbgen.LockAccountParams{ID: req.AccountId, FamilyID: p.FamilyID, UserID: p.UserID})
	if err := accountErr(err, "lock account"); err != nil {
		return nil, err
	}
	if locked.ArchivedAt != nil {
		return nil, problem.Conflict(problem.CodeAccountArchived, "Счёт в архиве: сначала верните его из архива.")
	}
	acc, err := s.getAccount(ctx, q, p, req.AccountId)
	if err != nil {
		return nil, err
	}

	resp := oapi.AdjustAccountBalance200JSONResponse{Account: acc}
	diff := req.Body.Balance - acc.Balance
	if diff == 0 {
		return resp, nil // остаток уже такой: операция не нужна
	}
	txID, err := q.CreateAdjustment(ctx, dbgen.CreateAdjustmentParams{
		Now:       now,
		FamilyID:  p.FamilyID,
		AccountID: req.AccountId,
		Amount:    diff,
		OpDate:    dateIn(now, loc),
		CreatedBy: p.UserID,
	})
	if err != nil {
		return nil, fmt.Errorf("create adjustment: %w", err)
	}
	// Остаток перечитываем внутри транзакции: так ответ точно совпадает с тем,
	// что увидит следующий GET /accounts.
	if resp.Account, err = s.getAccount(ctx, q, p, req.AccountId); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit adjustment: %w", err)
	}
	resp.TransactionId = &txID
	return resp, nil
}

// getAccount читает один видимый счёт с остатком. q — s.q или запросы
// внутри транзакции.
func (s *server) getAccount(ctx context.Context, q *dbgen.Queries, p Principal, id uuid.UUID) (oapi.Account, error) {
	rows, err := q.ListAccounts(ctx, dbgen.ListAccountsParams{FamilyID: p.FamilyID, UserID: p.UserID, OnlyID: &id})
	if err != nil {
		return oapi.Account{}, fmt.Errorf("get account: %w", err)
	}
	if len(rows) == 0 {
		return oapi.Account{}, errAccountNotFound()
	}
	return accountFromRow(rows[0]), nil
}

func accountFromRow(r dbgen.ListAccountsRow) oapi.Account {
	visibility := visibilityShared
	if r.OwnerUserID != nil {
		// Невидимые чужие личные счета сюда не попадают (фильтр в SQL),
		// поэтому личный — значит, личный текущего пользователя.
		visibility = visibilityPrivate
	}
	var color *oapi.AccountColor
	if r.Color != nil {
		c := oapi.AccountColor(*r.Color)
		color = &c
	}
	return oapi.Account{
		Id:              r.ID,
		Name:            r.Name,
		Type:            oapi.AccountType(r.Type),
		Currency:        r.CurrencyCode,
		Visibility:      visibility,
		InitialBalance:  r.InitialBalance,
		Balance:         r.Balance,
		IncludeInTotal:  r.IncludeInTotal,
		Color:           color,
		SortOrder:       r.SortOrder,
		ArchivedAt:      r.ArchivedAt,
		HasTransactions: r.HasTransactions,
	}
}

// accountName обрезает пробелы по краям и проверяет то, что схемой не выразить.
// Длину (1–100) проверил валидатор контракта — до обрезки.
func accountName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	switch {
	case name == "":
		return "", problem.Validation(problem.FieldError{Field: "name", Code: "required", Message: "Укажите название счёта."})
	case hasControlChars(name):
		return "", problem.Validation(problem.FieldError{Field: "name", Code: "invalid_format", Message: "Название содержит недопустимые символы."})
	}
	return name, nil
}

func colorToDB(c *oapi.AccountColor) *string {
	if c == nil {
		return nil
	}
	s := string(*c)
	return &s
}

// accountErr превращает «нет строк» (счёт не виден пользователю) в 404,
// остальные ошибки — в 500 с контекстом для лога.
func accountErr(err error, op string) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return errAccountNotFound()
	}
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

func errAccountHasTransactions() *problem.Problem {
	return problem.Conflict(problem.CodeAccountHasTransactions,
		"У счёта есть операции: его можно только архивировать.")
}

// dateIn — календарная дата момента t в поясе loc, как полночь UTC
// (так sqlc передаёт колонки date, см. docs/api.md → «Соответствие типов»).
func dateIn(t time.Time, loc *time.Location) time.Time {
	y, m, d := t.In(loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == foreignKeyViolation
}
