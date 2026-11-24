package rates

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/testdb"
)

func TestMain(m *testing.M) { testdb.Main(m) }

// fakeCBR — заглушка XML-сервиса ЦБ: история курсов в памяти, ответы
// в том же формате и кодировке, что у настоящего.
type fakeCBR struct {
	mu      sync.Mutex
	ids     map[string]string             // CharCode → id ЦБ (список daily)
	history map[string]map[string]fakeRec // id → "dd.mm.yyyy" → курс
	// broken — id, история которого отдаётся мусором; dailyDown — daily отвечает 500.
	broken    string
	dailyDown bool
	requests  []string // запросы dynamic: "id from to"
}

type fakeRec struct{ nominal, value string }

func newFakeCBR(t *testing.T) (*fakeCBR, *Client) {
	f := &fakeCBR{
		ids:     map[string]string{"USD": "R01235", "EUR": "R01239", "JPY": "R01820"},
		history: map[string]map[string]fakeRec{},
	}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return f, NewClient(srv.URL + "/")
}

func (f *fakeCBR) set(id, d, nominal, value string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.history[id] == nil {
		f.history[id] = map[string]fakeRec{}
	}
	f.history[id][d] = fakeRec{nominal, value}
}

func (f *fakeCBR) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	q := r.URL.Query()
	var b strings.Builder
	b.WriteString(`<?xml version="1.0" encoding="windows-1251"?>`)
	switch r.URL.Path {
	case "/XML_daily.asp":
		if f.dailyDown {
			http.Error(w, "down", http.StatusInternalServerError)
			return
		}
		d, err := time.Parse(cbrQueryDate, q.Get("date_req"))
		if err != nil {
			b.WriteString("<ValCurs>Error in parameters</ValCurs>")
			break
		}
		fmt.Fprintf(&b, `<ValCurs Date="%s" name="Foreign Currency Market">`, d.Format(cbrDate))
		// Название в windows-1251 («Валюта»): декодер должен его пережить.
		for code, id := range f.ids {
			fmt.Fprintf(&b, `<Valute ID="%s"><CharCode>%s</CharCode><Nominal>1</Nominal><Name>`+
				"\xc2\xe0\xeb\xfe\xf2\xe0"+`</Name><Value>1,0</Value></Valute>`, id, code)
		}
		b.WriteString("</ValCurs>")
	case "/XML_dynamic.asp":
		id := q.Get("VAL_NM_RQ")
		from, err1 := time.Parse(cbrQueryDate, q.Get("date_req1"))
		to, err2 := time.Parse(cbrQueryDate, q.Get("date_req2"))
		if err1 != nil || err2 != nil {
			b.WriteString("<ValCurs>Error in parameters</ValCurs>")
			break
		}
		f.requests = append(f.requests, id+" "+from.Format(time.DateOnly)+" "+to.Format(time.DateOnly))
		if id == f.broken {
			fmt.Fprintf(&b, `<ValCurs ID="%s"><Record Date="01.02.2024" Id="%s"><Nominal>1</Nominal><Value>н/д</Value></Record></ValCurs>`, id, id)
			break
		}
		fmt.Fprintf(&b, `<ValCurs ID="%s" name="Foreign Currency Market Dynamic">`, id)
		var dates []time.Time
		for s := range f.history[id] {
			d, _ := time.Parse(cbrDate, s)
			if !d.Before(from) && !d.After(to) {
				dates = append(dates, d)
			}
		}
		sort.Slice(dates, func(i, j int) bool { return dates[i].Before(dates[j]) })
		for _, d := range dates {
			rec := f.history[id][d.Format(cbrDate)]
			fmt.Fprintf(&b, `<Record Date="%s" Id="%s"><Nominal>%s</Nominal><Value>%s</Value></Record>`,
				d.Format(cbrDate), id, rec.nominal, rec.value)
		}
		b.WriteString("</ValCurs>")
	default:
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/xml; charset=windows-1251")
	_, _ = w.Write([]byte(b.String()))
}

func (f *fakeCBR) takeRequests() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := f.requests
	f.requests = nil
	sort.Strings(out)
	return out
}

// lockedBuffer — буфер для лога, в который могут писать из нескольких горутин.
type lockedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *lockedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *lockedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// setup очищает курсы (БД общая для тестов пакета) и возвращает Syncer с часами,
// которые тест двигает через *now.
func setup(t *testing.T, client *Client) (*pgxpool.Pool, *Syncer, *time.Time, *lockedBuffer) {
	t.Helper()
	pool := testdb.Pool(t)
	if _, err := pool.Exec(context.Background(), "DELETE FROM exchange_rates"); err != nil {
		t.Fatal(err)
	}
	// 05.03.2024 23:30 по Москве = 20:30 UTC: «завтра» — 06.03.
	now := time.Date(2024, 3, 5, 20, 30, 0, 0, time.UTC)
	logs := &lockedBuffer{}
	s := NewSyncer(client, pool, slog.New(slog.NewTextHandler(logs, nil)), Options{
		HistoryStart: date(2024, 2, 1),
		Now:          func() time.Time { return now },
	})
	return pool, s, &now, logs
}

// rates возвращает курсы валюты из БД: "yyyy-mm-dd" → курс как текст numeric.
func dbRates(t *testing.T, pool *pgxpool.Pool, code string) map[string]string {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		"SELECT rate_date::text, rate::text FROM exchange_rates WHERE currency_code = $1", code)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var d, r string
		if err := rows.Scan(&d, &r); err != nil {
			t.Fatal(err)
		}
		out[d] = r
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func mustSync(t *testing.T, s *Syncer) Result {
	t.Helper()
	res, err := s.Sync(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestSyncFirstLoadThenIncremental(t *testing.T) {
	cbr, client := newFakeCBR(t)
	pool, s, now, _ := setup(t, client)

	cbr.set("R01235", "31.01.2024", "1", "89,0000") // раньше начала истории — не нужен
	cbr.set("R01235", "01.02.2024", "1", "89,6741")
	cbr.set("R01235", "02.02.2024", "1", "90,2849")
	cbr.set("R01235", "06.03.2024", "1", "91,1604") // «завтра» — уже опубликован
	cbr.set("R01239", "01.02.2024", "100", "6172,7100")
	cbr.set("R01239", "02.02.2024", "10", "1,00000005") // 0,100000005 → 8 знаков

	// Первая загрузка: курсов нет — вся история с HistoryStart по «завтра».
	res := mustSync(t, s)
	if res.Currencies != 2 || res.Written != 5 {
		t.Fatalf("первая загрузка: %+v", res)
	}
	if got := cbr.takeRequests(); strings.Join(got, ";") !=
		"R01235 2024-02-01 2024-03-06;R01239 2024-02-01 2024-03-06" {
		t.Fatalf("запросы: %v", got)
	}
	usd := dbRates(t, pool, "USD")
	want := map[string]string{"2024-02-01": "89.67410000", "2024-02-02": "90.28490000", "2024-03-06": "91.16040000"}
	if fmt.Sprint(usd) != fmt.Sprint(want) {
		t.Fatalf("USD: %v", usd)
	}
	// Курс за 1 единицу = Value / Nominal, в numeric.
	eur := dbRates(t, pool, "EUR")
	if eur["2024-02-01"] != "61.72710000" || eur["2024-02-02"] != "0.10000001" {
		t.Fatalf("EUR: %v", eur)
	}

	// Повторный запуск ничего не меняет, но захватывает 7 дней до последней даты.
	res = mustSync(t, s)
	if res.Written != 0 {
		t.Fatalf("повтор записал %d", res.Written)
	}
	if got := cbr.takeRequests(); strings.Join(got, ";") !=
		"R01235 2024-02-28 2024-03-06;R01239 2024-01-26 2024-03-06" {
		t.Fatalf("догрузка с перекрытием: %v", got)
	}

	// Следующий день: новый курс догружается, ЦБ поправил курс в пределах перекрытия.
	*now = now.Add(24 * time.Hour)
	cbr.set("R01235", "07.03.2024", "1", "90,7493")
	cbr.set("R01235", "06.03.2024", "1", "91,2000")
	res = mustSync(t, s)
	if res.Written != 2 {
		t.Fatalf("догрузка и поправка: %+v", res)
	}
	usd = dbRates(t, pool, "USD")
	if len(usd) != 4 || usd["2024-03-06"] != "91.20000000" || usd["2024-03-07"] != "90.74930000" {
		t.Fatalf("USD после догрузки: %v", usd)
	}
}

func TestSyncCBRErrorKeepsLoadedRates(t *testing.T) {
	cbr, client := newFakeCBR(t)
	pool, s, _, _ := setup(t, client)
	cbr.set("R01235", "01.02.2024", "1", "89,6741")
	cbr.set("R01239", "01.02.2024", "1", "97,0000")
	mustSync(t, s)

	// ЦБ недоступен: ошибка, ничего не тронуто.
	cbr.dailyDown = true
	if _, err := s.Sync(context.Background()); err == nil || !strings.Contains(err.Error(), "HTTP 500") {
		t.Fatalf("daily 500: %v", err)
	}
	cbr.dailyDown = false

	// Мусор в истории одной валюты: ошибка по ней, другая обновляется,
	// уже загруженное по сломанной валюте остаётся как было.
	cbr.broken = "R01239"
	cbr.set("R01235", "02.02.2024", "1", "90,2849")
	cbr.set("R01239", "02.02.2024", "1", "98,0000")
	res, err := s.Sync(context.Background())
	if err == nil || !strings.Contains(err.Error(), "EUR") {
		t.Fatalf("ошибка по EUR: %v", err)
	}
	if res.Currencies != 1 || res.Written != 1 {
		t.Fatalf("%+v", res)
	}
	if usd := dbRates(t, pool, "USD"); len(usd) != 2 {
		t.Fatalf("USD: %v", usd)
	}
	if eur := dbRates(t, pool, "EUR"); fmt.Sprint(eur) != "map[2024-02-01:97.00000000]" {
		t.Fatalf("EUR: %v", eur)
	}
}

func TestSyncCurrencyUnknownToCBR(t *testing.T) {
	cbr, client := newFakeCBR(t)
	pool, s, _, logs := setup(t, client)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO currencies (code, name, symbol, minor_units, is_active)
		VALUES ('XTS', 'Тестовая', 'T', 2, false)`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, "DELETE FROM currencies WHERE code = 'XTS'") })
	cbr.set("R01235", "01.02.2024", "1", "89,6741")

	res := mustSync(t, s)
	if res.Currencies != 2 || res.Written != 1 {
		t.Fatalf("%+v", res)
	}
	if !strings.Contains(logs.String(), "currency=XTS") {
		t.Fatalf("нет предупреждения в логе: %s", logs)
	}
	for _, r := range cbr.takeRequests() {
		if strings.Contains(r, "XTS") {
			t.Fatalf("запрос по XTS: %s", r)
		}
	}
}

func TestRunSurvivesPanicAndStops(t *testing.T) {
	pool := testdb.Pool(t)
	logs := &lockedBuffer{}
	logger := slog.New(slog.NewTextHandler(logs, nil))

	// Клиента нет — синхронизация паникует на первом запросе к ЦБ.
	// Паника перехватывается и пишется в лог, процесс жив.
	NewSyncer(nil, pool, logger, Options{}).syncLogged(context.Background())
	if !strings.Contains(logs.String(), "rates: sync panicked") {
		t.Fatalf("паника не в логе: %s", logs)
	}

	cbr, client := newFakeCBR(t)
	_, s, _, logs := setup(t, client)
	cbr.set("R01235", "01.02.2024", "1", "89,6741")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		s.Run(ctx, time.Hour)
	}()
	// Первая синхронизация — сразу при старте.
	deadline := time.Now().Add(10 * time.Second)
	for !strings.Contains(logs.String(), "rates: synced") {
		if time.Now().After(deadline) {
			t.Fatalf("синхронизации при старте нет: %s", logs)
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run не остановился после отмены контекста")
	}
}
