package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
)

// apiClient — минимальный клиент API от имени одного пользователя. Cookie
// сессии хранит cookiejar, как браузер; у каждого пользователя свой клиент.
type apiClient struct {
	base string // адрес API без «/» в конце, например http://localhost:8081
	http *http.Client
}

func newAPIClient(base string) (*apiClient, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	return &apiClient{base: strings.TrimRight(base, "/"), http: &http.Client{Jar: jar}}, nil
}

// do отправляет запрос к /api/v1+path. body кодируется в JSON (nil — без тела),
// ответ 2xx раскодируется в out (nil — тело не нужно). Ответ не 2xx — ошибка
// с телом problem+json: по нему сразу видно, какая проверка API не прошла.
func (c *apiClient) do(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+"/api/v1"+path, reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	// Запросы идут как из браузера со страницы того же origin: так они проходят
	// ту же защиту от CSRF (http.CrossOriginProtection), что и запросы фронта,
	// а не путь «заголовков нет — это curl».
	req.Header.Set("Sec-Fetch-Site", "same-origin")

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("%s %s: %s: %s", method, path, resp.Status, bytes.TrimSpace(data))
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("%s %s: разбор ответа: %w", method, path, err)
		}
	}
	return nil
}

// sessionCookie возвращает значение cookie pa_session, которую выдал API.
// Cookie выдана с Path=/api, поэтому спрашиваем jar про адрес под /api.
func (c *apiClient) sessionCookie() (string, error) {
	u, err := url.Parse(c.base + "/api/v1/me")
	if err != nil {
		return "", err
	}
	for _, ck := range c.http.Jar.Cookies(u) {
		if ck.Name == "pa_session" {
			return ck.Value, nil
		}
	}
	return "", fmt.Errorf("API не выдал cookie pa_session")
}
