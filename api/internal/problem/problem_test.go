package problem_test

import (
	"bytes"
	"encoding/json"
	"testing"

	"personal-accounting/api/internal/oapi"
	"personal-accounting/api/internal/problem"
)

// strictDecode разбирает JSON и падает на полях, которых нет в dst.
func strictDecode(t *testing.T, data []byte, dst any) {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		t.Fatalf("поля расходятся: %v\nJSON: %s", err, data)
	}
}

// problem.Problem написан руками, а oapi.Problem сгенерирован из контракта.
// Тест следит, чтобы набор и имена полей совпадали в обе стороны.
func TestProblemMatchesContract(t *testing.T) {
	// Все поля заполнены, иначе omitempty скрыл бы расхождение.
	p := problem.Validation(problem.FieldError{Field: "amount", Code: "required", Message: "Обязательное поле."})

	data, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	var generated oapi.Problem
	strictDecode(t, data, &generated)
	if generated.Code != p.Code || generated.Status != p.Status || generated.Errors == nil || len(*generated.Errors) != 1 {
		t.Fatalf("значения потеряны: %+v", generated)
	}

	back, err := json.Marshal(generated)
	if err != nil {
		t.Fatal(err)
	}
	var own problem.Problem
	strictDecode(t, back, &own)
	if own.Detail != p.Detail || own.Errors[0] != p.Errors[0] || own.Type != p.Type || own.Title != p.Title {
		t.Fatalf("после обратного разбора: %+v, ожидалось %+v", own, *p)
	}
}
