package rates

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"runtime/debug"
	"time"

	"personal-accounting/api/internal/db/dbgen"
)

const (
	// BaseCurrency — валюта, в которой ЦБ выражает курсы; её курс не загружается.
	BaseCurrency = "RUB"
	// DefaultInterval — как часто фоновый цикл проверяет новые курсы.
	DefaultInterval = 3 * time.Hour
	// overlapDays — сколько дней перед последней загруженной датой загружать
	// заново: ЦБ изредка поправляет уже опубликованный курс.
	overlapDays = 7
	// syncTimeout — предел на одну синхронизацию в фоне: зависший ЦБ или БД
	// не должны остановить цикл навсегда.
	syncTimeout = 10 * time.Minute
)

// DefaultHistoryStart — с какой даты загружается история валюты, курсов
// которой в БД ещё нет.
var DefaultHistoryStart = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)

// moscow — часовой пояс ЦБ. С 2014 года это постоянно UTC+3, поэтому
// фиксированное смещение, а не база часовых поясов. Ошибка в час-другой
// для старых дат не важна: запрашиваем курсы с запасом, по «завтра».
var moscow = time.FixedZone("MSK", 3*60*60)

// Syncer загружает курсы ЦБ в exchange_rates.
type Syncer struct {
	client       *Client
	queries      *dbgen.Queries
	logger       *slog.Logger
	historyStart time.Time
	now          func() time.Time
}

// Options — необязательные настройки Syncer. Нулевые значения — умолчания.
type Options struct {
	HistoryStart time.Time        // по умолчанию DefaultHistoryStart
	Now          func() time.Time // часы; подменяются в тестах
}

// NewSyncer создаёт синхронизацию. db — пул соединений (или транзакция в тестах).
func NewSyncer(client *Client, db dbgen.DBTX, logger *slog.Logger, opts Options) *Syncer {
	s := &Syncer{
		client:       client,
		queries:      dbgen.New(db),
		logger:       logger,
		historyStart: opts.HistoryStart,
		now:          opts.Now,
	}
	if s.historyStart.IsZero() {
		s.historyStart = DefaultHistoryStart
	}
	if s.now == nil {
		s.now = time.Now
	}
	return s
}

// Result — итог синхронизации для лога.
type Result struct {
	Currencies int   // сколько валют загружено без ошибок
	Written    int64 // новые и изменённые строки
}

// Sync догружает недостающие курсы всех валют справочника, кроме базовой.
// По валюте без курсов загружается вся история с HistoryStart, по остальным —
// с последней загруженной даты минус overlapDays, по «завтра» включительно
// (ЦБ устанавливает курс на следующий рабочий день заранее).
//
// Ошибка по одной валюте не мешает остальным: Sync продолжает и возвращает
// все ошибки вместе. Валюта, которой у ЦБ нет, — предупреждение в лог, не ошибка.
// Запись идемпотентна, поэтому повторный или параллельный запуск безопасен.
func (s *Syncer) Sync(ctx context.Context) (Result, error) {
	var res Result
	codes, err := s.queries.ListRateCurrencies(ctx, BaseCurrency)
	if err != nil {
		return res, fmt.Errorf("список валют: %w", err)
	}
	if len(codes) == 0 {
		return res, nil
	}
	lastRows, err := s.queries.ListLastRateDates(ctx)
	if err != nil {
		return res, fmt.Errorf("последние даты курсов: %w", err)
	}
	last := make(map[string]time.Time, len(lastRows))
	for _, r := range lastRows {
		last[r.CurrencyCode] = r.LastDate
	}

	y, m, d := s.now().In(moscow).Date()
	to := time.Date(y, m, d+1, 0, 0, 0, 0, time.UTC) // «завтра» по Москве

	// Коды ЦБ (R01235 и т. п.) берём из ежедневного списка, а не хардкодим.
	daily, err := s.client.Daily(ctx, to)
	if err != nil {
		return res, fmt.Errorf("список валют ЦБ: %w", err)
	}
	ids := make(map[string]string, len(daily.Valutes))
	for _, v := range daily.Valutes {
		ids[v.CharCode] = v.ID
	}

	var errs []error
	for _, code := range codes {
		id, ok := ids[code]
		if !ok {
			s.logger.Warn("rates: валюты нет в списке ЦБ, курсы не загружаются", "currency", code)
			continue
		}
		from := s.historyStart
		if l, ok := last[code]; ok {
			from = l.AddDate(0, 0, -overlapDays)
		}
		n, err := s.syncCurrency(ctx, code, id, from, to)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", code, err))
			continue
		}
		res.Currencies++
		res.Written += n
	}
	return res, errors.Join(errs...)
}

func (s *Syncer) syncCurrency(ctx context.Context, code, id string, from, to time.Time) (int64, error) {
	rates, err := s.client.Dynamic(ctx, id, from, to)
	if err != nil {
		return 0, err
	}
	if len(rates) == 0 {
		return 0, nil
	}
	// Одна дата в пачке дважды — ошибка ON CONFLICT DO UPDATE («affect row
	// a second time»). У ЦБ такого не бывает, но защищаемся: берём последнюю.
	index := make(map[time.Time]int, len(rates))
	p := dbgen.UpsertExchangeRatesParams{CurrencyCode: code}
	for _, r := range rates {
		if i, ok := index[r.Date]; ok {
			p.RateValues[i], p.Nominals[i] = r.Value, r.Nominal
			continue
		}
		index[r.Date] = len(p.Dates)
		p.Dates = append(p.Dates, r.Date)
		p.RateValues = append(p.RateValues, r.Value)
		p.Nominals = append(p.Nominals, r.Nominal)
	}
	n, err := s.queries.UpsertExchangeRates(ctx, p)
	if err != nil {
		return 0, fmt.Errorf("запись курсов: %w", err)
	}
	return n, nil
}

// Run синхронизирует курсы сразу и затем каждые interval, пока не отменён ctx.
// Ошибки и паника одной синхронизации пишутся в лог и не останавливают цикл:
// следующая попытка — на следующем такте. Возвращается после отмены ctx.
func (s *Syncer) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		s.syncLogged(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Syncer) syncLogged(ctx context.Context) {
	// recover работает только в defer той же горутины: паника в синхронизации
	// иначе уронила бы весь процесс API.
	defer func() {
		if p := recover(); p != nil {
			s.logger.Error("rates: sync panicked", "panic", p, "stack", string(debug.Stack()))
		}
	}()
	syncCtx, cancel := context.WithTimeout(ctx, syncTimeout)
	defer cancel()
	started := time.Now()
	res, err := s.Sync(syncCtx)
	attrs := []any{"currencies", res.Currencies, "written", res.Written, "duration", time.Since(started).Round(time.Millisecond)}
	switch {
	case err != nil && ctx.Err() != nil:
		// Остановка сервера во время синхронизации — не ошибка.
		s.logger.Info("rates: sync interrupted by shutdown")
	case err != nil:
		s.logger.Warn("rates: sync failed, retry on next tick", append(attrs, "err", err.Error())...)
	default:
		s.logger.Info("rates: synced", attrs...)
	}
}
