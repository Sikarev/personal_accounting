package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"
)

// --- Помощники ---------------------------------------------------------------

// setRates заменяет курсы валюты cur (дата → «рублей за 1 единицу») и
// удаляет их после теста. exchange_rates — общая таблица, не по семьям, а
// БД у тестов пакета одна: без очистки курсы одного теста попали бы в другой
// (тесты пакета идут последовательно, t.Parallel не используется).
func (e authEnv) setRates(t *testing.T, cur string, rates map[string]string) {
	t.Helper()
	ctx := context.Background()
	clear := func() {
		if _, err := e.pool.Exec(ctx, `DELETE FROM exchange_rates WHERE currency_code = $1`, cur); err != nil {
			t.Fatal(err)
		}
	}
	clear()
	t.Cleanup(clear)
	for d, r := range rates {
		if _, err := e.pool.Exec(ctx,
			`INSERT INTO exchange_rates (currency_code, rate_date, rate) VALUES ($1, $2, $3::numeric)`,
			cur, d, r); err != nil {
			t.Fatalf("курс %s %s: %v", cur, d, err)
		}
	}
}

// testCurrency — валюта без копеек (minor_units = 0) для проверки множителя
// 10^(minor_units базы − minor_units валюты). XTS — код ISO 4217 «для
// тестов». Неактивна, поэтому в GET /currencies не попадает; счёт получает
// её прямо в БД (setAccountCurrency).
const testCurrency = "XTS"

func (e authEnv) ensureTestCurrency(t *testing.T) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(), `
		INSERT INTO currencies (code, name, symbol, minor_units, is_active)
		VALUES ($1, 'Тестовая', 'T', 0, false) ON CONFLICT DO NOTHING`, testCurrency); err != nil {
		t.Fatal(err)
	}
}

// setAccountCurrency меняет валюту счёта прямо в БД: API создаёт счета
// только в активных валютах, а для тестов нужны и EUR, и XTS.
func (e authEnv) setAccountCurrency(t *testing.T, accountID, cur string) {
	t.Helper()
	if _, err := e.pool.Exec(context.Background(),
		`UPDATE accounts SET currency_code = $2 WHERE id = $1`, accountID, cur); err != nil {
		t.Fatal(err)
	}
}

type categoryReport struct {
	Currency string `json:"currency"`
	Total    int64  `json:"total"`
	Items    []struct {
		CategoryID string `json:"categoryId"`
		Amount     int64  `json:"amount"`
	} `json:"items"`
	MissingRates []string `json:"missingRates"`
}

// byCategory — суммы отчёта по id категории.
func (r categoryReport) byCategory() map[string]int64 {
	m := map[string]int64{}
	for _, it := range r.Items {
		m[it.CategoryID] = it.Amount
	}
	return m
}

type monthlyItem struct {
	Month   string `json:"month"`
	Expense int64  `json:"expense"`
	Income  int64  `json:"income"`
}

type monthlyReport struct {
	Currency     string        `json:"currency"`
	Items        []monthlyItem `json:"items"`
	MissingRates []string      `json:"missingRates"`
}

type balancePoint struct {
	Date    string `json:"date"`
	Balance int64  `json:"balance"`
}

type balanceReport struct {
	Currency     string         `json:"currency"`
	Step         string         `json:"step"`
	Items        []balancePoint `json:"items"`
	MissingRates []string       `json:"missingRates"`
}

// report делает GET /reports/<path>?<query> и разбирает ответ в out.
// Массивы items и missingRates обязаны быть массивами, а не null.
func (e authEnv) report(t *testing.T, u accUser, path, query string, out any) {
	t.Helper()
	rec := e.as(u, http.MethodGet, "/reports/"+path+"?"+query, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("отчёт %s?%s: %d %s", path, query, rec.Code, rec.Body)
	}
	raw := decodeJSON(t, rec)
	for _, k := range []string{"items", "missingRates"} {
		if _, ok := raw[k].([]any); !ok {
			t.Fatalf("%s — не массив: %s", k, rec.Body)
		}
	}
	if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
		t.Fatal(err)
	}
}

func (e authEnv) catReport(t *testing.T, u accUser, query string) categoryReport {
	t.Helper()
	var r categoryReport
	e.report(t, u, "categories", query, &r)
	return r
}

func (e authEnv) monthReport(t *testing.T, u accUser, query string) monthlyReport {
	t.Helper()
	var r monthlyReport
	e.report(t, u, "monthly", query, &r)
	return r
}

func (e authEnv) balReport(t *testing.T, u accUser, query string) balanceReport {
	t.Helper()
	var r balanceReport
	e.report(t, u, "balance", query, &r)
	return r
}

func wantMissing(t *testing.T, got []string, want ...string) {
	t.Helper()
	if want == nil {
		want = []string{}
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("missingRates = %v, ожидалось %v", got, want)
	}
}

func wantPoints(t *testing.T, r balanceReport, step string, want []balancePoint) {
	t.Helper()
	if r.Step != step || !reflect.DeepEqual(r.Items, want) {
		t.Fatalf("баланс: шаг %s, точки %v; ожидались %s, %v", r.Step, r.Items, step, want)
	}
}

func (e authEnv) post(t *testing.T, u accUser, path, body string) {
	t.Helper()
	if rec := e.as(u, http.MethodPost, path, body); rec.Code >= 300 {
		t.Fatalf("POST %s: %d %s", path, rec.Code, rec.Body)
	}
}

// --- Пересчёт ----------------------------------------------------------------

func TestReportCurrencyConversion(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	food := e.catID(t, u.familyID, "expense", "Продукты")
	taxi := e.catID(t, u.familyID, "expense", "Такси")
	usd := e.createAccount(t, u, usdAccountBody("Доллары", "shared"))["id"].(string)
	eur := e.createAccount(t, u, accountBody("Евро", "shared", 0))["id"].(string)
	e.setAccountCurrency(t, eur, "EUR")
	e.setRates(t, "EUR", nil) // у EUR нет ни одного курса

	// 9 января 2026 — пятница, 12-е — понедельник: в выходные курса нет.
	e.setRates(t, "USD", map[string]string{"2026-01-09": "90.00000000", "2026-01-12": "92.12345678"})
	e.createTx(t, u, expenseReq(usd, food, 1000, "2026-01-10")) // суббота → курс пятницы: 10 $ × 90 = 900 ₽
	e.createTx(t, u, expenseReq(usd, food, 100, "2026-01-05"))  // раньше истории → первый курс после: 90 ₽
	e.createTx(t, u, expenseReq(usd, taxi, 100, "2026-01-12"))  // курс на дату: 92,12345678 ₽ → 9212 коп.
	e.createTx(t, u, expenseReq(eur, food, 5000, "2026-01-10")) // нет курсов — в отчёт не входит
	e.createTx(t, u, expenseReq(usd, food, 100, "2026-02-01"))  // позже последнего курса → последний

	r := e.catReport(t, u, "kind=expense&from=2026-01-01&to=2026-01-31")
	if r.Currency != "RUB" {
		t.Fatalf("валюта отчёта %q", r.Currency)
	}
	if got, want := r.byCategory(), map[string]int64{food: 99000, taxi: 9212}; !reflect.DeepEqual(got, want) {
		t.Fatalf("по категориям: %v, ожидалось %v", got, want)
	}
	// total — точная сумма: 99000 + 9212,345678 → 108212.
	if r.Total != 108212 {
		t.Fatalf("total = %d", r.Total)
	}
	wantMissing(t, r.MissingRates, "EUR")

	m := e.monthReport(t, u, "from=2026-01-01&to=2026-02-28")
	wantMonths := []monthlyItem{{"2026-01-01", 108212, 0}, {"2026-02-01", 9212, 0}}
	if !reflect.DeepEqual(m.Items, wantMonths) {
		t.Fatalf("по месяцам: %v, ожидалось %v", m.Items, wantMonths)
	}
	wantMissing(t, m.MissingRates, "EUR")

	// Валюта без операций в периоде в missingRates не попадает.
	r = e.catReport(t, u, "kind=expense&from=2026-02-01&to=2026-02-28")
	wantMissing(t, r.MissingRates)
}

// Округление — «половина от нуля», один раз на число ответа. XTS — без
// копеек, курс уже за 1 единицу (номинал ЦБ, например «за 100 иен», в БД
// уже поделён): 1 XTS × 0,005 ₽ × 10^(2−0) = 0,5 коп.
func TestReportRounding(t *testing.T) {
	e := newAuthEnv(t, Options{})
	e.ensureTestCurrency(t)
	u := e.newUser(t)
	food := e.catID(t, u.familyID, "expense", "Продукты")
	cafe := e.catID(t, u.familyID, "expense", "Кафе и рестораны")
	gifts := e.catID(t, u.familyID, "expense", "Подарки")
	acc := e.createAccount(t, u, accountBody("Тест", "shared", 0))["id"].(string)
	e.setAccountCurrency(t, acc, testCurrency)
	e.setRates(t, testCurrency, map[string]string{"2026-03-01": "0.00500000"})

	e.createTx(t, u, expenseReq(acc, food, 1, "2026-03-02"))  // 0,5 коп. → 1
	e.createTx(t, u, expenseReq(acc, cafe, 1, "2026-03-02"))  // 0,5 коп. → 1
	e.createTx(t, u, expenseReq(acc, gifts, 5, "2026-03-02")) // 2,5 коп. → 3 (банковское дало бы 2)

	r := e.catReport(t, u, "kind=expense&from=2026-03-01&to=2026-03-31")
	if got, want := r.byCategory(), map[string]int64{food: 1, cafe: 1, gifts: 3}; !reflect.DeepEqual(got, want) {
		t.Fatalf("по категориям: %v, ожидалось %v", got, want)
	}
	// Точная сумма 3,5 → 4, а сумма округлённых — 5: total не сумма items.
	if r.Total != 4 {
		t.Fatalf("total = %d, ожидалось 4", r.Total)
	}
	// Первой — большая сумма, при равенстве — по id.
	if r.Items[0].CategoryID != gifts {
		t.Fatalf("порядок: %v", r.Items)
	}
	wantMissing(t, r.MissingRates)
}

// --- По категориям -----------------------------------------------------------

func TestCategoryReport(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	member := e.addMember(t, u)
	transport := e.catID(t, u.familyID, "expense", "Транспорт")
	taxi := e.catID(t, u.familyID, "expense", "Такси")
	gifts := e.catID(t, u.familyID, "expense", "Подарки")
	salary := e.catID(t, u.familyID, "income", "Зарплата")
	cash := e.createAccount(t, u, accountBody("Наличные", "shared", 0))["id"].(string)
	card := e.createAccount(t, u, accountBody("Карта", "shared", 0))["id"].(string)

	today := dateIn(e.clock.Now(), mustLoadLocation(t, "Europe/Moscow")).Format(time.DateOnly)
	e.createTx(t, u, expenseReq(cash, transport, 1000, today)) // родитель — только свои
	e.createTx(t, u, expenseReq(cash, taxi, 300, today))       // подкатегория — отдельно
	e.createTx(t, u, expenseReq(card, taxi, 200, today))
	e.createTx(t, member, expenseReq(card, gifts, 700, today))
	e.createTx(t, u, incomeReq(cash, salary, 50000, today))
	e.createTx(t, u, transferReq(cash, card, 400, today))
	deleted := e.createTxID(t, u, expenseReq(cash, transport, 99999, today))
	if rec := e.as(u, http.MethodDelete, "/transactions/"+deleted, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("удаление: %d", rec.Code)
	}
	// Корректировка (тоже «сегодня») в отчёт не входит.
	e.post(t, u, "/accounts/"+cash+"/adjust-balance", `{"balance":1}`)
	// Архивная категория остаётся в отчёте: операции у неё сохраняются.
	e.post(t, u, "/categories/"+gifts+"/archive", "")

	period := "&from=" + today + "&to=" + today
	r := e.catReport(t, u, "kind=expense"+period)
	if got, want := r.byCategory(), map[string]int64{transport: 1000, taxi: 500, gifts: 700}; !reflect.DeepEqual(got, want) {
		t.Fatalf("расходы: %v, ожидалось %v", got, want)
	}
	if r.Total != 2200 || r.Items[0].CategoryID != transport || r.Items[2].CategoryID != taxi {
		t.Fatalf("total или порядок: %+v", r)
	}

	r = e.catReport(t, u, "kind=income"+period)
	if got, want := r.byCategory(), map[string]int64{salary: 50000}; !reflect.DeepEqual(got, want) || r.Total != 50000 {
		t.Fatalf("доходы: %+v", r)
	}

	// Фильтры: счёт, автор (значения одного параметра — «или»).
	r = e.catReport(t, u, "kind=expense&accountId="+card+period)
	if got, want := r.byCategory(), map[string]int64{taxi: 200, gifts: 700}; !reflect.DeepEqual(got, want) {
		t.Fatalf("фильтр по счёту: %v", got)
	}
	r = e.catReport(t, u, "kind=expense&authorId="+member.id+period)
	if got, want := r.byCategory(), map[string]int64{gifts: 700}; !reflect.DeepEqual(got, want) {
		t.Fatalf("фильтр по автору: %v", got)
	}
	r = e.catReport(t, u, "kind=expense&authorId="+member.id+"&accountId="+cash+period)
	if len(r.Items) != 0 || r.Total != 0 {
		t.Fatalf("фильтры «и»: %+v", r)
	}

	// Вне периода — ничего.
	r = e.catReport(t, u, "kind=expense&from=2020-01-01&to=2020-12-31")
	if len(r.Items) != 0 || r.Total != 0 {
		t.Fatalf("пустой период: %+v", r)
	}
}

// --- По месяцам --------------------------------------------------------------

func TestMonthlyReport(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	food := e.catID(t, u.familyID, "expense", "Продукты")
	salary := e.catID(t, u.familyID, "income", "Зарплата")
	cash := e.createAccount(t, u, accountBody("Наличные", "shared", 0))["id"].(string)
	card := e.createAccount(t, u, accountBody("Карта", "shared", 0))["id"].(string)

	e.createTx(t, u, expenseReq(cash, food, 1, "2026-01-14"))   // до from — не входит
	e.createTx(t, u, expenseReq(cash, food, 100, "2026-01-15")) // from
	e.createTx(t, u, incomeReq(cash, salary, 5000, "2026-01-31"))
	e.createTx(t, u, transferReq(cash, card, 777, "2026-02-10")) // перевод — не входит
	e.createTx(t, u, incomeReq(card, salary, 3000, "2026-03-31"))
	e.createTx(t, u, expenseReq(card, food, 250, "2026-04-10")) // to
	e.createTx(t, u, expenseReq(card, food, 2, "2026-04-11"))   // после to — не входит

	m := e.monthReport(t, u, "from=2026-01-15&to=2026-04-10")
	want := []monthlyItem{
		{"2026-01-01", 100, 5000},
		{"2026-02-01", 0, 0}, // пустой месяц — с нулями
		{"2026-03-01", 0, 3000},
		{"2026-04-01", 250, 0},
	}
	if m.Currency != "RUB" || !reflect.DeepEqual(m.Items, want) {
		t.Fatalf("по месяцам: %+v, ожидалось %v", m, want)
	}
	wantMissing(t, m.MissingRates)

	// Один день — один месяц.
	m = e.monthReport(t, u, "from=2026-04-10&to=2026-04-10&accountId="+card)
	if want := []monthlyItem{{"2026-04-01", 250, 0}}; !reflect.DeepEqual(m.Items, want) {
		t.Fatalf("один день: %v", m.Items)
	}
	// Фильтр по автору: чужой id — пусто, но месяцы на месте.
	m = e.monthReport(t, u, "from=2026-01-15&to=2026-02-01&authorId="+u.familyID)
	if want := []monthlyItem{{"2026-01-01", 0, 0}, {"2026-02-01", 0, 0}}; !reflect.DeepEqual(m.Items, want) {
		t.Fatalf("фильтр по автору: %v", m.Items)
	}
}

// --- Баланс ------------------------------------------------------------------

func TestBalancePoints(t *testing.T) {
	d := func(s string) time.Time {
		v, err := time.Parse(time.DateOnly, s)
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	format := func(ps []time.Time) []string {
		out := make([]string, 0, len(ps))
		for _, p := range ps {
			out = append(out, p.Format(time.DateOnly))
		}
		return out
	}
	cases := []struct {
		from, to string
		step     string
		count    int      // число точек
		head     []string // первые точки
	}{
		{"2026-01-01", "2026-01-01", "day", 1, []string{"2026-01-01"}},
		{"2026-01-01", "2026-01-31", "day", 31, []string{"2026-01-01", "2026-01-02"}}, // 31 день
		// 32 дня → недели. 2026-01-01 — четверг: первая точка — воскресенье 4-го.
		{"2026-01-01", "2026-02-01", "week", 5, []string{"2026-01-04", "2026-01-11"}},
		// 184 дня (01.01–03.07) — ещё недели; 185 — уже месяцы.
		{"2026-01-01", "2026-07-03", "week", 27, []string{"2026-01-04"}},
		{"2026-01-01", "2026-07-04", "month", 7, []string{"2026-01-31", "2026-02-28"}},
		// from — воскресенье: первая неделя из одного дня.
		{"2026-01-04", "2026-02-10", "week", 7, []string{"2026-01-04", "2026-01-11"}},
		// Месяцы с обрезкой: from и to в середине месяца.
		{"2026-01-15", "2026-08-10", "month", 8, []string{"2026-01-31", "2026-02-28", "2026-03-31"}},
		// 10 лет без дня — 120 месяцев.
		{"2016-01-01", "2025-12-31", "month", 120, []string{"2016-01-31", "2016-02-29"}},
	}
	for _, c := range cases {
		step, points := balancePoints(d(c.from), d(c.to))
		got := format(points)
		if string(step) != c.step || len(got) != c.count || !reflect.DeepEqual(got[:len(c.head)], c.head) ||
			got[len(got)-1] != c.to {
			t.Errorf("%s…%s: шаг %s, точки %v; ожидались %s, %d шт., начало %v, конец %s",
				c.from, c.to, step, got, c.step, c.count, c.head, c.to)
		}
	}
}

func TestBalanceReport(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	food := e.catID(t, u.familyID, "expense", "Продукты")
	cash := e.createAccount(t, u, accountBody("Наличные", "shared", 10000))["id"].(string)
	hidden := e.createAccount(t, u, `{"name":"Копилка","type":"cash","currency":"RUB","visibility":"shared",
		"initialBalance":5000,"includeInTotal":false}`)["id"].(string)
	usd := e.createAccount(t, u, usdAccountBody("Доллары", "shared"))["id"].(string)
	old := e.createAccount(t, u, accountBody("Старый", "shared", 700))["id"].(string)
	e.post(t, u, "/accounts/"+old+"/archive", "") // архивный, но в балансе

	e.setRates(t, "USD", map[string]string{"2026-05-01": "90.00000000", "2026-05-12": "95.50000000"})
	e.createTx(t, u, expenseReq(cash, food, 3000, "2026-05-01")) // до from — в первой точке
	// Обмен: 90 ₽ (9000 коп.) → 100 $ (10000 центов).
	tr := transferReq(cash, usd, 9000, "2026-05-11")
	tr.ToAmount = 10000
	e.createTx(t, u, tr)
	e.createTx(t, u, expenseReq(cash, food, 20000, "2026-05-12")) // наличные уходят в минус
	e.createTx(t, u, expenseReq(cash, food, 1, "2026-05-14"))     // после to — не входит

	r := e.balReport(t, u, "from=2026-05-10&to=2026-05-12")
	// В копейках. 10.05: 10000 − 3000 + 700 = 7700.
	// 11.05: −2000 + 700 + 10000 центов × 90 (курс от 01.05) = 898700.
	// 12.05: −22000 + 700 + 10000 × 95,5 = 933700.
	wantPoints(t, r, "day", []balancePoint{{"2026-05-10", 7700}, {"2026-05-11", 898700}, {"2026-05-12", 933700}})
	wantMissing(t, r.MissingRates)
	if r.Currency != "RUB" {
		t.Fatalf("валюта: %q", r.Currency)
	}

	// Счёт вне общего итога — только явным фильтром.
	r = e.balReport(t, u, "from=2026-05-10&to=2026-05-11&accountId="+hidden)
	wantPoints(t, r, "day", []balancePoint{{"2026-05-10", 5000}, {"2026-05-11", 5000}})
	r = e.balReport(t, u, "from=2026-05-10&to=2026-05-11&accountId="+hidden+"&accountId="+usd)
	wantPoints(t, r, "day", []balancePoint{{"2026-05-10", 5000}, {"2026-05-11", 905000}})

	// Месяцы: точки — конец месяца, последняя — to.
	r = e.balReport(t, u, "from=2025-12-15&to=2026-06-20&accountId="+cash)
	wantPoints(t, r, "month", []balancePoint{
		{"2025-12-31", 10000}, {"2026-01-31", 10000}, {"2026-02-28", 10000}, {"2026-03-31", 10000},
		{"2026-04-30", 10000}, {"2026-05-31", -22001}, {"2026-06-20", -22001},
	})

	// Валюта без курсов: счёт не входит, код — в missingRates.
	e.setRates(t, "USD", nil)
	r = e.balReport(t, u, "from=2026-05-12&to=2026-05-12")
	wantPoints(t, r, "day", []balancePoint{{"2026-05-12", -21300}})
	wantMissing(t, r.MissingRates, "USD")
}

// --- Видимость и изоляция ----------------------------------------------------

func TestReportsVisibility(t *testing.T) {
	e := newAuthEnv(t, Options{})
	owner := e.newUser(t)
	member := e.addMember(t, owner)
	stranger := e.newUser(t) // другая семья
	food := e.catID(t, owner.familyID, "expense", "Продукты")
	shared := e.createAccount(t, owner, accountBody("Общий", "shared", 1000))["id"].(string)
	private := e.createAccount(t, owner, accountBody("Личный", "private", 50000))["id"].(string)

	const day = "2026-06-10"
	e.createTx(t, owner, expenseReq(private, food, 700, day))
	e.createTx(t, owner, expenseReq(shared, food, 100, day))
	e.createTx(t, owner, transferReq(private, shared, 2000, day)) // «личный → общий»

	const period = "from=" + day + "&to=" + day
	// Владелец видит всё.
	if r := e.catReport(t, owner, "kind=expense&"+period); r.Total != 800 {
		t.Fatalf("владелец, категории: %+v", r)
	}
	wantPoints(t, e.balReport(t, owner, period), "day", []balancePoint{{day, 1000 + 50000 - 700 - 100}})

	// Участник: только общий счёт; перевод учтён только общей стороной.
	if r := e.catReport(t, member, "kind=expense&"+period); r.Total != 100 || len(r.Items) != 1 {
		t.Fatalf("участник, категории: %+v", r)
	}
	if m := e.monthReport(t, member, period); m.Items[0].Expense != 100 {
		t.Fatalf("участник, по месяцам: %+v", m)
	}
	wantPoints(t, e.balReport(t, member, period), "day", []balancePoint{{day, 1000 - 100 + 2000}})

	// Фильтр по чужому личному счёту — пусто, а не ошибка.
	for _, u := range []accUser{member, stranger} {
		q := period + "&accountId=" + private
		if r := e.catReport(t, u, "kind=expense&"+q); len(r.Items) != 0 || r.Total != 0 {
			t.Fatalf("категории по чужому счёту: %+v", r)
		}
		if m := e.monthReport(t, u, q); m.Items[0].Expense != 0 {
			t.Fatalf("по месяцам по чужому счёту: %+v", m)
		}
		wantPoints(t, e.balReport(t, u, q), "day", []balancePoint{{day, 0}})
	}

	// Другая семья: ни своих, ни чужих данных, и общий счёт чужой семьи не находится.
	if r := e.catReport(t, stranger, "kind=expense&"+period); len(r.Items) != 0 || r.Total != 0 {
		t.Fatalf("чужая семья, категории: %+v", r)
	}
	if m := e.monthReport(t, stranger, period); m.Items[0] != (monthlyItem{"2026-06-01", 0, 0}) {
		t.Fatalf("чужая семья, по месяцам: %+v", m)
	}
	wantPoints(t, e.balReport(t, stranger, period), "day", []balancePoint{{day, 0}})
	wantPoints(t, e.balReport(t, stranger, period+"&accountId="+shared), "day", []balancePoint{{day, 0}})
}

// --- Ошибки параметров -------------------------------------------------------

func TestReportParamErrors(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	for _, path := range []string{"categories?kind=expense&", "monthly?", "balance?"} {
		get := func(q string) *httptest.ResponseRecorder {
			return e.as(u, http.MethodGet, "/reports/"+path+q, "")
		}
		wantFieldErr(t, get("to=2026-01-01"), "from:required")
		wantFieldErr(t, get("from=2026-01-01"), "to:required")
		wantFieldErr(t, get("from=2026-01-02&to=2026-01-01"), "to:invalid_range")
		wantFieldErr(t, get("from=2016-01-01&to=2026-01-01"), "to:period_too_long")
		wantFieldErr(t, get("from=2026-02-31&to=2026-03-01"), "from:invalid_format")
		// Ровно 10 лет без дня — можно.
		if rec := get("from=2016-01-01&to=2025-12-31"); rec.Code != http.StatusOK {
			t.Fatalf("%s 10 лет: %d %s", path, rec.Code, rec.Body)
		}
	}
	wantFieldErr(t, e.as(u, http.MethodGet, "/reports/categories?kind=transfer&from=2026-01-01&to=2026-01-01", ""),
		"kind:invalid_value")
	wantFieldErr(t, e.as(u, http.MethodGet, "/reports/categories?from=2026-01-01&to=2026-01-01", ""),
		"kind:required")

	// Без сессии — 401.
	rec := e.send(http.MethodGet, "/api/v1/reports/balance?from=2026-01-01&to=2026-01-01", "")
	decodeProblem(t, rec, http.StatusUnauthorized, "unauthorized")
}

// --- Остаток счёта в базовой валюте ------------------------------------------

func TestAccountBaseBalance(t *testing.T) {
	e := newAuthEnv(t, Options{})
	u := e.newUser(t)
	rub := e.createAccount(t, u, accountBody("Рубли", "shared", -12345))["id"].(string)
	usd := e.createAccount(t, u, `{"name":"Доллары","type":"card","currency":"USD","visibility":"shared",
		"initialBalance":12345}`)["id"].(string)
	baseOf := func(id string) any { return e.findAccount(t, u, id)["baseBalance"] }

	// Нет ни одного курса — null; у рублёвого счёта — сам остаток.
	e.setRates(t, "USD", nil)
	if b := baseOf(usd); b != nil {
		t.Fatalf("без курсов: %v", b)
	}
	if b := baseOf(rub); b != float64(-12345) {
		t.Fatalf("рублёвый: %v", b)
	}

	today := dateIn(e.clock.Now(), mustLoadLocation(t, "Europe/Moscow"))
	day := func(n int) string { return today.AddDate(0, 0, n).Format(time.DateOnly) }

	// Последний курс не позже «сегодня»; будущий не используется.
	// 123,45 $ × 90,5 = 11172,225 ₽ = 1117222,5 коп. → 1117223 (половина — от нуля).
	e.setRates(t, "USD", map[string]string{day(-10): "80.00000000", day(-1): "90.50000000", day(3): "100.00000000"})
	if b := baseOf(usd); b != float64(1117223) {
		t.Fatalf("по последнему курсу: %v", b)
	}
	// Курс на сегодня есть — берётся он.
	e.setRates(t, "USD", map[string]string{day(0): "100.00000000", day(3): "1.00000000"})
	if b := baseOf(usd); b != float64(1234500) {
		t.Fatalf("курс на сегодня: %v", b)
	}
	// Только будущие курсы — ближайший следующий.
	e.setRates(t, "USD", map[string]string{day(2): "2.00000000", day(5): "3.00000000"})
	if b := baseOf(usd); b != float64(24690) {
		t.Fatalf("ближайший следующий: %v", b)
	}

	// Поле есть и в ответах изменения счёта.
	rec := e.as(u, http.MethodPost, "/accounts/"+usd+"/adjust-balance", `{"balance":100}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("корректировка: %d %s", rec.Code, rec.Body)
	}
	if b := decodeJSON(t, rec)["account"].(map[string]any)["baseBalance"]; b != float64(200) {
		t.Fatalf("после корректировки: %v", b)
	}
}

// --- Вспомогательное ---------------------------------------------------------

func mustLoadLocation(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatal(err)
	}
	return loc
}
