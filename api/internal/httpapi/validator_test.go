package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/go-chi/chi/v5"

	"personal-accounting/api/internal/oapi"
)

// Эндпоинтов с телом в контракте пока нет, поэтому валидатор проверяется
// на тестовой спецификации с тем же префиксом /api/v1.
const testSpec = `
openapi: 3.0.3
info: {title: test, version: "1"}
servers: [{url: /api/v1}]
paths:
  /things/{thingId}:
    post:
      operationId: createThing
      parameters:
        - {name: thingId, in: path, required: true, schema: {type: string, format: uuid}}
        - {name: limit, in: query, schema: {type: integer, minimum: 1, maximum: 100}}
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required: [name, kind]
              properties:
                name: {type: string, maxLength: 5}
                kind: {type: string, enum: [expense, income]}
                amount: {type: integer, format: int64}
                split:
                  type: object
                  additionalProperties: false
                  required: [amount]
                  properties:
                    amount: {type: integer}
      responses:
        "204": {description: ok}
`

func testValidatorRouter(t *testing.T) http.Handler {
	t.Helper()
	doc, err := openapi3.NewLoader().LoadFromData([]byte(testSpec))
	if err != nil {
		t.Fatal(err)
	}
	if err := doc.Validate(context.Background()); err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Route("/api/v1", func(v1 chi.Router) {
		v1.With(requestValidator(discardLogger, newSpecRoutes(doc, apiPrefix))).
			Post("/things/{thingId}", func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusNoContent)
			})
	})
	return r
}

const validThingPath = "/api/v1/things/0193b7c2-1f7e-7c4e-9a51-3c2d1e0f9a8b"

func postJSON(h http.Handler, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// fieldCodes возвращает пары «поле: код» из errors[], отсортированные.
func fieldCodes(t *testing.T, body map[string]any) []string {
	t.Helper()
	errs, _ := body["errors"].([]any)
	var out []string
	for _, e := range errs {
		fe := e.(map[string]any)
		if msg, _ := fe["message"].(string); msg == "" {
			t.Errorf("пустое message у %v", fe)
		}
		out = append(out, fe["field"].(string)+": "+fe["code"].(string))
	}
	sort.Strings(out)
	return out
}

func TestValidatorAcceptsValidRequest(t *testing.T) {
	rec := postJSON(testValidatorRouter(t), validThingPath+"?limit=10",
		`{"name":"Кофе","kind":"expense","amount":35050,"split":{"amount":1}}`)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("статус %d: %s", rec.Code, rec.Body)
	}
}

func TestValidatorFieldErrors(t *testing.T) {
	h := testValidatorRouter(t)
	cases := []struct {
		name, path, body string
		want             []string
	}{
		{"нет обязательного поля", validThingPath, `{"name":"a"}`,
			[]string{"kind: required"}},
		{"неверный тип", validThingPath, `{"name":"a","kind":"income","amount":"сто"}`,
			[]string{"amount: invalid_type"}},
		{"значение не из enum", validThingPath, `{"name":"a","kind":"gift"}`,
			[]string{"kind: invalid_value"}},
		{"лишнее поле", validThingPath, `{"name":"a","kind":"income","isAdmin":true}`,
			[]string{"isAdmin: unknown_field"}},
		{"слишком длинная строка", validThingPath, `{"name":"абвгде","kind":"income"}`,
			[]string{"name: too_long"}},
		{"вложенное поле", validThingPath, `{"name":"a","kind":"income","split":{"amount":"x","extra":1}}`,
			[]string{"split.amount: invalid_type", "split.extra: unknown_field"}},
		{"несколько ошибок сразу", validThingPath, `{"name":"абвгде","kind":"gift"}`,
			[]string{"kind: invalid_value", "name: too_long"}},
		{"параметр пути", "/api/v1/things/not-a-uuid", `{"name":"a","kind":"income"}`,
			[]string{"thingId: invalid_format"}},
		{"параметр query", validThingPath + "?limit=1000", `{"name":"a","kind":"income"}`,
			[]string{"limit: too_large"}},
		{"параметр query не число", validThingPath + "?limit=abc", `{"name":"a","kind":"income"}`,
			[]string{"limit: invalid_format"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			rec := postJSON(h, c.path, c.body)
			body := decodeProblem(t, rec, http.StatusUnprocessableEntity, "validation_failed")
			if got := fieldCodes(t, body); !reflect.DeepEqual(got, c.want) {
				t.Fatalf("errors: %v, ожидалось %v\nтело: %s", got, c.want, rec.Body)
			}
		})
	}
}

func TestValidatorMalformedBody(t *testing.T) {
	h := testValidatorRouter(t)
	for name, body := range map[string]string{
		"невалидный JSON": `{"name":`,
		"пустое тело":     ``,
	} {
		t.Run(name, func(t *testing.T) {
			decodeProblem(t, postJSON(h, validThingPath, body), http.StatusBadRequest, "bad_request")
		})
	}
}

// Соглашение контракта: схемы тел запросов запрещают лишние поля
// (additionalProperties: false), иначе валидатор пропустит опечатку в имени поля.
func TestContractRequestBodiesForbidAdditionalProperties(t *testing.T) {
	doc, err := oapi.GetSpec()
	if err != nil {
		t.Fatal(err)
	}
	for path, item := range doc.Paths.Map() {
		for method, op := range item.Operations() {
			if op.RequestBody == nil || op.RequestBody.Value == nil {
				continue
			}
			for ct, media := range op.RequestBody.Value.Content {
				checkClosedObjects(t, method+" "+path+" "+ct, media.Schema, map[*openapi3.Schema]bool{})
			}
		}
	}
}

func checkClosedObjects(t *testing.T, where string, ref *openapi3.SchemaRef, seen map[*openapi3.Schema]bool) {
	if ref == nil || ref.Value == nil || seen[ref.Value] {
		return
	}
	s := ref.Value
	seen[s] = true
	if s.Type.Is(openapi3.TypeObject) && s.AdditionalProperties.Schema == nil &&
		(s.AdditionalProperties.Has == nil || *s.AdditionalProperties.Has) {
		t.Errorf("%s: у объекта нет additionalProperties: false", where)
	}
	for name, p := range s.Properties {
		checkClosedObjects(t, where+"."+name, p, seen)
	}
	checkClosedObjects(t, where+"[]", s.Items, seen)
	for _, list := range []openapi3.SchemaRefs{s.AllOf, s.OneOf, s.AnyOf} {
		for _, sub := range list {
			checkClosedObjects(t, where, sub, seen)
		}
	}
}

// Тело у операции, для которой в контракте нет requestBody, отклоняется.
func TestValidatorRejectsUnexpectedBody(t *testing.T) {
	h := newRouter(t, discardLogger, closedPool(t))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/currencies", strings.NewReader(`{"x":1}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	decodeProblem(t, rec, http.StatusBadRequest, "bad_request")
}

// Ответ валидатора — тот же problem+json, что разбирает клиент.
func TestValidatorProblemIsJSON(t *testing.T) {
	rec := postJSON(testValidatorRouter(t), validThingPath, `{}`)
	var p map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil || rec.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("%v %s", err, rec.Body)
	}
}
