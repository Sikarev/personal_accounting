// Package rates загружает курсы ЦБ РФ в таблицу exchange_rates: клиент
// официального XML-сервиса ЦБ, разбор ответов, синхронизация с БД и фоновый
// цикл в процессе API. Подробности — в docs/api.md, «Курсы ЦБ РФ».
package rates

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultBaseURL — официальный XML-сервис ЦБ РФ (https://www.cbr.ru/development/SXML/).
const DefaultBaseURL = "https://www.cbr.ru/scripts"

const (
	// requestTimeout — предел на один запрос к ЦБ. История валюты с 2000 года —
	// около 800 КБ, ЦБ отдаёт её за доли секунды.
	requestTimeout = time.Minute
	// maxResponseSize — защита от бесконечного ответа: настоящий ответ меньше 1 МБ.
	maxResponseSize = 16 << 20
	// userAgent — нейтральный, без адресов и имён.
	userAgent = "personal-accounting-rates/1.0"
)

// Client — клиент XML-сервиса ЦБ.
type Client struct {
	baseURL string
	http    *http.Client
}

// NewClient создаёт клиента. baseURL — без завершающего «/»
// (DefaultBaseURL или адрес httptest-сервера в тестах).
func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		http:    &http.Client{Timeout: requestTimeout},
	}
}

// Daily возвращает курсы всех валют на дату. Если на дату курсов ещё нет
// (будущая дата), ЦБ отдаёт последние установленные — дату смотри в Daily.Date.
func (c *Client) Daily(ctx context.Context, date time.Time) (Daily, error) {
	q := url.Values{"date_req": {date.Format(cbrQueryDate)}}
	var out Daily
	err := c.get(ctx, "/XML_daily.asp", q, func(r io.Reader) (err error) {
		out, err = ParseDaily(r)
		return err
	})
	return out, err
}

// Dynamic возвращает курсы валюты id (код ЦБ вида R01235) за период
// from…to включительно — только даты, на которые ЦБ курс устанавливал.
func (c *Client) Dynamic(ctx context.Context, id string, from, to time.Time) ([]Rate, error) {
	q := url.Values{
		"date_req1": {from.Format(cbrQueryDate)},
		"date_req2": {to.Format(cbrQueryDate)},
		"VAL_NM_RQ": {id},
	}
	var out []Rate
	err := c.get(ctx, "/XML_dynamic.asp", q, func(r io.Reader) (err error) {
		out, err = ParseDynamic(r, id)
		return err
	})
	return out, err
}

func (c *Client) get(ctx context.Context, path string, q url.Values, parse func(io.Reader) error) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("ЦБ %s: HTTP %d", path, resp.StatusCode)
	}
	if err := parse(io.LimitReader(resp.Body, maxResponseSize)); err != nil {
		return fmt.Errorf("ЦБ %s: %w", path, err)
	}
	return nil
}
