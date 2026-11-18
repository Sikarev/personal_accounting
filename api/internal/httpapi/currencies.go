package httpapi

import (
	"context"
	"fmt"

	"personal-accounting/api/internal/oapi"
)

func (s *server) ListCurrencies(ctx context.Context, _ oapi.ListCurrenciesRequestObject) (oapi.ListCurrenciesResponseObject, error) {
	rows, err := s.q.ListActiveCurrencies(ctx)
	if err != nil {
		// %w оборачивает ошибку с контекстом; клиенту она не уйдёт — только в лог.
		return nil, fmt.Errorf("list active currencies: %w", err)
	}

	// make(..., 0, n), а не nil-срез: пустой список сериализуется в [], а не в null.
	items := make([]oapi.Currency, 0, len(rows))
	for _, row := range rows {
		items = append(items, oapi.Currency{
			Code:       row.Code,
			Name:       row.Name,
			Symbol:     row.Symbol,
			MinorUnits: int(row.MinorUnits),
		})
	}
	return oapi.ListCurrencies200JSONResponse{Items: items}, nil
}
