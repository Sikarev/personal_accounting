package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"personal-accounting/api/internal/auth"
	"personal-accounting/api/internal/oapi"
)

const (
	// password — общий пароль обоих пользователей devseed; печатается в выводе.
	password = "devseed-password"
	timezone = "Europe/Moscow"
	// workers — сколько операций создаётся одновременно. Порядок создания
	// на данные не влияет (план готов заранее), а параллельность ускоряет
	// замеры с тысячами операций в разы.
	workers = 8
)

type seedResult struct {
	ownerEmail, memberEmail string
	familyID                string
	cookie                  string
	transactions            int
	duration                time.Duration
}

// accountSpec — счёт, который devseed создаёт через POST /accounts.
// key — имя счёта в плане операций (id становятся известны только после создания).
type accountSpec struct {
	key        string
	name       string
	typ        oapi.AccountType
	currency   string
	visibility oapi.AccountVisibility
	initial    int64
	color      oapi.AccountColor
}

// Счета владельца. Порядок списка — порядок в интерфейсе.
var ownerAccounts = []accountSpec{
	{accCard, "Карта Сбер", oapi.Card, "RUB", oapi.Shared, 4_500_000, oapi.Indigo},
	{accCash, "Наличные", oapi.Cash, "RUB", oapi.Shared, 800_000, oapi.Green},
	{accCredit, "Кредитка", oapi.CreditCard, "RUB", oapi.Shared, -2_500_000, oapi.Red},
	{accUSD, "Доллары", oapi.Cash, "USD", oapi.Shared, 50_000, oapi.Teal},
	{accOld, "Старая карта", oapi.Card, "RUB", oapi.Shared, 300_000, oapi.Gray},
	{accPersonal, "Моя карта", oapi.Card, "RUB", oapi.Private, 3_000_000, oapi.Violet},
}

var memberAccount = accountSpec{accMember, "Карта Анны", oapi.Card, "RUB", oapi.Private, 2_000_000, oapi.Pink}

// seed создаёт владельца с данными и второго участника семьи.
func seed(ctx context.Context, pool *pgxpool.Pool, o options, out io.Writer) (seedResult, error) {
	started := time.Now()
	var res seedResult

	var hasUSD bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM exchange_rates WHERE currency_code = 'USD')`).Scan(&hasUSD); err != nil {
		return res, err
	}
	if !hasUSD {
		// Курсы сами не грузим: это делает API в фоне или cmd/rates, а devseed
		// не должен зависеть от доступности ЦБ.
		fmt.Fprintln(out, "devseed: в exchange_rates нет курсов USD — запусти go run ./cmd/rates sync, "+
			"иначе долларовый счёт не войдёт в общий баланс и отчёты")
	}

	loc, err := time.LoadLocation(timezone)
	if err != nil {
		return res, err
	}
	now := time.Now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	// Время в адресе делает его уникальным между запусками; второй запуск
	// в ту же секунду получит 422 email_taken — это честная ошибка.
	stamp := now.Format("20060102-150405")
	res.ownerEmail = "devseed-" + stamp + "@example.com"
	res.memberEmail = "devseed-" + stamp + "-member@example.com"

	owner, err := newAPIClient(o.api)
	if err != nil {
		return res, err
	}
	err = owner.do(ctx, http.MethodPost, "/auth/register", oapi.RegisterRequest{
		AcceptTerms: oapi.True, Email: res.ownerEmail, Name: "Иван (devseed)",
		Password: password, Timezone: timezone,
	}, nil)
	if err != nil {
		return res, fmt.Errorf("регистрация (API запущен на %s?): %w", o.api, err)
	}
	if res.cookie, err = owner.sessionCookie(); err != nil {
		return res, err
	}
	var me struct {
		Family struct {
			ID string `json:"id"`
		} `json:"family"`
	}
	if err := owner.do(ctx, http.MethodGet, "/me", nil, &me); err != nil {
		return res, err
	}
	res.familyID = me.Family.ID

	// Подтверждение e-mail — в БД: ссылка из письма devseed ни к чему,
	// а без подтверждения интерфейс показывает плашку, которая мешает проверкам.
	if _, err := pool.Exec(ctx,
		`UPDATE users SET email_verified_at = now() WHERE email = $1`, res.ownerEmail); err != nil {
		return res, err
	}

	accounts := map[string]openapi_types.UUID{}
	for _, a := range ownerAccounts {
		if accounts[a.key], err = createAccount(ctx, owner, a); err != nil {
			return res, err
		}
	}
	categories, err := listCategories(ctx, owner)
	if err != nil {
		return res, err
	}

	// План целиком строится до запросов, поэтому одно и то же зерно даёт
	// одинаковые данные при любом порядке ответов сервера.
	plan := buildPlan(o.seed, today, o.ops)
	reqs, err := toRequests(plan, accounts, categories)
	if err != nil {
		return res, err
	}
	if err := createAll(ctx, owner, reqs); err != nil {
		return res, err
	}
	res.transactions = len(reqs)

	// Дальше — по одному: каждому шагу нужны все операции до него.

	// Мягко удалённая операция: создать и удалить, как «Отменить» в тосте.
	var created struct {
		ID openapi_types.UUID `json:"id"`
	}
	deleted, err := toRequest(txSpec{
		kind: oapi.TransactionInputKindExpense, account: accCard, amount: 123_400,
		category: "expense/Продукты", date: today.AddDate(0, 0, -2), comment: "Ошибочная запись — удалена",
	}, accounts, categories)
	if err != nil {
		return res, err
	}
	if err := owner.do(ctx, http.MethodPost, "/transactions", deleted, &created); err != nil {
		return res, err
	}
	if err := owner.do(ctx, http.MethodDelete, "/transactions/"+created.ID.String(), nil, nil); err != nil {
		return res, err
	}

	// Корректировка наличных: «пересчитал кошелёк — не хватает 370,50 ₽».
	// Целевой остаток считается от текущего, чтобы разница всегда была ненулевой.
	var list struct {
		Items []oapi.Account `json:"items"`
	}
	if err := owner.do(ctx, http.MethodGet, "/accounts", nil, &list); err != nil {
		return res, err
	}
	for _, a := range list.Items {
		if a.Id != accounts[accCash] {
			continue
		}
		err := owner.do(ctx, http.MethodPost, "/accounts/"+a.Id.String()+"/adjust-balance",
			oapi.AdjustBalanceRequest{Balance: a.Balance - 37_050}, nil)
		if err != nil {
			return res, err
		}
		res.transactions++
	}

	// Архив — после того как операции старой карты созданы: в архивный счёт
	// новые операции API уже не примет.
	if err := owner.do(ctx, http.MethodPost, "/accounts/"+accounts[accOld].String()+"/archive", nil, nil); err != nil {
		return res, err
	}

	n, err := seedMember(ctx, pool, o, res.memberEmail, res.familyID, today, accounts, categories)
	if err != nil {
		return res, fmt.Errorf("второй участник: %w", err)
	}
	res.transactions += n
	res.duration = time.Since(started).Round(time.Millisecond)
	return res, nil
}

// seedMember добавляет в семью участника с ролью member. Приглашений в API
// пока нет, поэтому пользователь и членство — напрямую в БД; дальше участник
// входит через API и создаёт свои данные как обычный пользователь.
func seedMember(ctx context.Context, pool *pgxpool.Pool, o options, email, familyID string,
	today time.Time, shared map[string]openapi_types.UUID, categories map[string]openapi_types.UUID) (int, error) {
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		var userID string
		err := tx.QueryRow(ctx, `
			INSERT INTO users (email, name, password_hash, timezone, email_verified_at,
			                   terms_accepted_at, terms_version)
			VALUES ($1, 'Анна (devseed)', $2, $3, now(), now(), 'devseed')
			RETURNING id`, email, auth.HashPassword(password), timezone).Scan(&userID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx,
			`INSERT INTO family_members (family_id, user_id, role) VALUES ($1, $2, 'member')`, familyID, userID)
		return err
	})
	if err != nil {
		return 0, err
	}

	member, err := newAPIClient(o.api)
	if err != nil {
		return 0, err
	}
	if err := member.do(ctx, http.MethodPost, "/auth/login",
		oapi.LoginRequest{Email: email, Password: password}, nil); err != nil {
		return 0, err
	}
	accounts := map[string]openapi_types.UUID{accCard: shared[accCard]}
	if accounts[accMember], err = createAccount(ctx, member, memberAccount); err != nil {
		return 0, err
	}
	reqs, err := toRequests(memberPlan(today), accounts, categories)
	if err != nil {
		return 0, err
	}
	return len(reqs), createAll(ctx, member, reqs)
}

func createAccount(ctx context.Context, c *apiClient, a accountSpec) (openapi_types.UUID, error) {
	color := a.color
	var acc oapi.Account
	err := c.do(ctx, http.MethodPost, "/accounts", oapi.CreateAccountRequest{
		Name: a.name, Type: a.typ, Currency: a.currency, Visibility: a.visibility,
		InitialBalance: &a.initial, Color: &color,
	}, &acc)
	return acc.Id, err
}

// listCategories возвращает категории семьи по ключу «вид/имя»: имя без вида
// не уникально («Подарки» есть и в расходах, и в доходах).
func listCategories(ctx context.Context, c *apiClient) (map[string]openapi_types.UUID, error) {
	var list struct {
		Items []oapi.Category `json:"items"`
	}
	if err := c.do(ctx, http.MethodGet, "/categories", nil, &list); err != nil {
		return nil, err
	}
	m := make(map[string]openapi_types.UUID, len(list.Items))
	for _, cat := range list.Items {
		m[string(cat.Kind)+"/"+cat.Name] = cat.Id
	}
	return m, nil
}

func toRequests(plan []txSpec, accounts, categories map[string]openapi_types.UUID) ([]oapi.TransactionRequest, error) {
	reqs := make([]oapi.TransactionRequest, 0, len(plan))
	for _, s := range plan {
		r, err := toRequest(s, accounts, categories)
		if err != nil {
			return nil, err
		}
		reqs = append(reqs, r)
	}
	return reqs, nil
}

// toRequest превращает строку плана в тело POST /transactions.
func toRequest(s txSpec, accounts, categories map[string]openapi_types.UUID) (oapi.TransactionRequest, error) {
	r := oapi.TransactionRequest{
		Kind: s.kind, Amount: s.amount, Date: openapi_types.Date{Time: s.date},
	}
	var ok bool
	if r.AccountId, ok = accounts[s.account]; !ok {
		return r, fmt.Errorf("в плане неизвестный счёт %q", s.account)
	}
	if s.comment != "" {
		r.Comment = &s.comment
	}
	if s.kind == oapi.TransactionInputKindTransfer {
		to, ok := accounts[s.to]
		if !ok {
			return r, fmt.Errorf("в плане неизвестный счёт %q", s.to)
		}
		r.ToAccountId = &to
		if s.toAmount != 0 {
			r.ToAmount = &s.toAmount
		}
		return r, nil
	}
	// Категории берутся из списка по умолчанию (defaultcategories.go);
	// если его переименуют, план нужно поправить — об этом и скажет ошибка.
	cat, ok := categories[s.category]
	if !ok {
		return r, fmt.Errorf("нет категории %q (изменился список по умолчанию?)", s.category)
	}
	r.CategoryId = &cat
	return r, nil
}

// createAll создаёт операции параллельно (workers запросов одновременно).
// Первая ошибка отменяет остальные запросы и возвращается.
func createAll(ctx context.Context, c *apiClient, reqs []oapi.TransactionRequest) error {
	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)

	jobs := make(chan oapi.TransactionRequest)
	var wg sync.WaitGroup
	for range workers {
		wg.Go(func() {
			for r := range jobs {
				if err := c.do(ctx, http.MethodPost, "/transactions", r, nil); err != nil {
					cancel(err)
				}
			}
		})
	}
send:
	for _, r := range reqs {
		select {
		case jobs <- r:
		case <-ctx.Done():
			break send
		}
	}
	close(jobs)
	wg.Wait()
	if ctx.Err() != nil {
		// context.Cause — исходная ошибка запроса (или отмена по Ctrl+C),
		// а не безликое «context canceled».
		return context.Cause(ctx)
	}
	return nil
}
