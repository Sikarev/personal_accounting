package httpapi

import (
	"context"
	"fmt"
	"slices"
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"personal-accounting/api/internal/db/dbgen"
	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/problem"
)

// Отчёты в базовой валюте семьи. Пересчёт и правило выбора курса — в SQL
// (internal/db/queries/reports.sql), здесь — проверка периода, точки графика
// баланса и сборка ответа. Правила — в docs/api.md → «Отчёты».

const (
	// reportMaxYears — предел длины периода: to должен быть раньше, чем
	// from + 10 лет. Это 120 месяцев (121 при датах в середине месяца) и
	// до ~3650 групп «валюта × день» в запросе — с запасом укладывается в
	// бюджет времени ответа. Более длинной истории в MVP не ожидается.
	reportMaxYears = 10
	// balanceDayMaxDays и balanceWeekMaxDays — границы выбора шага графика
	// баланса по длине периода в днях (включительно): до месяца — по дням,
	// до полугода — по неделям, длиннее — по месяцам. Так точек не больше
	// ~31 и график остаётся читаемым.
	balanceDayMaxDays  = 31
	balanceWeekMaxDays = 184
)

// Шаги графика баланса. Свои константы, а не сгенерированные — по той же
// причине, что visibilityShared (имена значений enum oapi-codegen может менять).
const (
	balanceStepDay   = oapi.BalanceStep("day")
	balanceStepWeek  = oapi.BalanceStep("week")
	balanceStepMonth = oapi.BalanceStep("month")
)

// reportPeriod проверяет период отчёта (обязательность и формат дат
// проверил валидатор контракта) и возвращает его концы.
func reportPeriod(from, to openapi_types.Date) (time.Time, time.Time, error) {
	f, t := from.Time, to.Time
	if t.Before(f) {
		return f, t, problem.Validation(problem.FieldError{
			Field: "to", Code: "invalid_range", Message: "Конец периода раньше начала.",
		})
	}
	if !t.Before(f.AddDate(reportMaxYears, 0, 0)) {
		return f, t, problem.Validation(problem.FieldError{
			Field: "to", Code: "period_too_long", Message: "Период длиннее 10 лет.",
		})
	}
	return f, t, nil
}

// codeSet собирает коды валют без курсов из строк отчёта: каждая строка
// приносит свой список, в ответ уходит объединение по коду.
type codeSet map[string]struct{}

func (s codeSet) add(codes []string) {
	for _, c := range codes {
		s[c] = struct{}{}
	}
}

func (s codeSet) sorted() []string {
	out := make([]string, 0, len(s)) // в JSON — [], а не null
	for c := range s {
		out = append(out, c)
	}
	slices.Sort(out)
	return out
}

func (s *server) GetCategoryReport(ctx context.Context, req oapi.GetCategoryReportRequestObject) (oapi.GetCategoryReportResponseObject, error) {
	p := currentUser(ctx)
	prm := req.Params
	from, to, err := reportPeriod(prm.From, prm.To)
	if err != nil {
		return nil, err
	}
	// Тот же разбор фильтров, что у ленты; вид и поиск в отчёте свои / не нужны.
	f := newTxFilters(nil, nil, nil, prm.AccountId, nil, prm.AuthorId, nil)

	resp := oapi.GetCategoryReport200JSONResponse{Items: []oapi.CategoryReportItem{}}
	missing := codeSet{}
	// Одна транзакция REPEATABLE READ: код валюты и суммы — из одного снимка.
	err = s.readTx(ctx, func(q *dbgen.Queries) error {
		if resp.Currency, err = q.GetFamilyBaseCurrency(ctx, p.FamilyID); err != nil {
			return fmt.Errorf("get base currency: %w", err)
		}
		rows, err := q.CategoryReport(ctx, dbgen.CategoryReportParams{
			FamilyID: p.FamilyID, UserID: p.UserID, Kind: string(prm.Kind),
			DateFrom: from, DateTo: to, AccountIds: f.accounts, AuthorIds: f.authors,
		})
		if err != nil {
			return fmt.Errorf("category report: %w", err)
		}
		for _, r := range rows {
			resp.Total = r.Total // одинаков во всех строках (оконная сумма)
			missing.add(r.Missing)
			// 0 — либо у всех операций категории валюта без курсов, либо
			// пересчитанная сумма меньше половины копейки.
			if r.Amount > 0 {
				resp.Items = append(resp.Items, oapi.CategoryReportItem{CategoryId: r.CategoryID, Amount: r.Amount})
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	resp.MissingRates = missing.sorted()
	return resp, nil
}

func (s *server) GetMonthlyReport(ctx context.Context, req oapi.GetMonthlyReportRequestObject) (oapi.GetMonthlyReportResponseObject, error) {
	p := currentUser(ctx)
	prm := req.Params
	from, to, err := reportPeriod(prm.From, prm.To)
	if err != nil {
		return nil, err
	}
	f := newTxFilters(nil, nil, nil, prm.AccountId, nil, prm.AuthorId, nil)

	resp := oapi.GetMonthlyReport200JSONResponse{}
	missing := codeSet{}
	var rows []dbgen.MonthlyReportRow
	err = s.readTx(ctx, func(q *dbgen.Queries) error {
		if resp.Currency, err = q.GetFamilyBaseCurrency(ctx, p.FamilyID); err != nil {
			return fmt.Errorf("get base currency: %w", err)
		}
		rows, err = q.MonthlyReport(ctx, dbgen.MonthlyReportParams{
			FamilyID: p.FamilyID, UserID: p.UserID,
			DateFrom: from, DateTo: to, AccountIds: f.accounts, AuthorIds: f.authors,
		})
		if err != nil {
			return fmt.Errorf("monthly report: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	byMonth := make(map[time.Time]dbgen.MonthlyReportRow, len(rows))
	for _, r := range rows {
		byMonth[r.Month] = r
		missing.add(r.Missing)
	}
	// SQL отдаёт только месяцы с операциями; пустые добавляются здесь нулями.
	resp.Items = []oapi.MonthlyReportItem{}
	for m := monthStart(from); !m.After(to); m = m.AddDate(0, 1, 0) {
		r := byMonth[m] // нет строки — нулевые суммы
		resp.Items = append(resp.Items, oapi.MonthlyReportItem{
			Month: openapi_types.Date{Time: m}, Expense: r.Expense, Income: r.Income,
		})
	}
	resp.MissingRates = missing.sorted()
	return resp, nil
}

func (s *server) GetBalanceReport(ctx context.Context, req oapi.GetBalanceReportRequestObject) (oapi.GetBalanceReportResponseObject, error) {
	p := currentUser(ctx)
	prm := req.Params
	from, to, err := reportPeriod(prm.From, prm.To)
	if err != nil {
		return nil, err
	}
	f := newTxFilters(nil, nil, nil, prm.AccountId, nil, nil, nil)
	step, points := balancePoints(from, to)

	resp := oapi.GetBalanceReport200JSONResponse{Step: step}
	missing := codeSet{}
	var rows []dbgen.BalanceReportRow
	err = s.readTx(ctx, func(q *dbgen.Queries) error {
		if resp.Currency, err = q.GetFamilyBaseCurrency(ctx, p.FamilyID); err != nil {
			return fmt.Errorf("get base currency: %w", err)
		}
		rows, err = q.BalanceReport(ctx, dbgen.BalanceReportParams{
			FamilyID: p.FamilyID, UserID: p.UserID,
			AccountIds: f.accounts, Points: points, DateTo: to,
		})
		if err != nil {
			return fmt.Errorf("balance report: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Строк нет, если не нашлось ни одного счёта: тогда все точки — нули.
	byDate := make(map[time.Time]int64, len(rows))
	for _, r := range rows {
		byDate[r.Point] = r.Balance
		missing.add(r.Missing)
	}
	resp.Items = make([]oapi.BalancePoint, 0, len(points))
	for _, d := range points {
		resp.Items = append(resp.Items, oapi.BalancePoint{Date: openapi_types.Date{Time: d}, Balance: byDate[d]})
	}
	resp.MissingRates = missing.sorted()
	return resp, nil
}

// balancePoints выбирает шаг графика по длине периода и возвращает точки:
// последний день каждого шага, пересекающегося с [from, to], обрезанный по
// to. Первая точка — конец шага, в который попадает from; последняя — to.
// Даты — полночь UTC (как date из БД), поэтому разница в днях точная.
func balancePoints(from, to time.Time) (oapi.BalanceStep, []time.Time) {
	days := int(to.Sub(from)/(24*time.Hour)) + 1
	step, stepEnd := balanceStepMonth, monthEnd
	switch {
	case days <= balanceDayMaxDays:
		step, stepEnd = balanceStepDay, func(d time.Time) time.Time { return d }
	case days <= balanceWeekMaxDays:
		step, stepEnd = balanceStepWeek, isoWeekEnd
	}
	var points []time.Time
	for d := stepEnd(from); d.Before(to); d = stepEnd(d.AddDate(0, 0, 1)) {
		points = append(points, d)
	}
	return step, append(points, to)
}

// monthStart — первое число месяца даты d.
func monthStart(d time.Time) time.Time {
	return time.Date(d.Year(), d.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// monthEnd — последнее число месяца даты d: нулевой день следующего месяца
// time.Date нормализует в последний день текущего.
func monthEnd(d time.Time) time.Time {
	return time.Date(d.Year(), d.Month()+1, 0, 0, 0, 0, 0, time.UTC)
}

// isoWeekEnd — воскресенье недели (ISO: пн–вс), в которую попадает d.
// time.Weekday считает воскресенье нулём, поэтому (7 − wd) % 7 дней до него.
func isoWeekEnd(d time.Time) time.Time {
	return d.AddDate(0, 0, (7-int(d.Weekday()))%7)
}
