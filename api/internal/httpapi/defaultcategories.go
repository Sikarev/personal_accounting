package httpapi

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"personal-accounting/api/internal/db/dbgen"
)

// defaultCategory — категория из набора по умолчанию; Children — подкатегории.
type defaultCategory struct {
	Name     string
	Children []string
}

// Набор категорий новой семьи. Список — в коде, а не в миграции: его можно
// менять, не трогая схему, и он применяется только к новым семьям.
// sort_order — позиция в списке (среди «соседей»), начиная с 1.
var (
	defaultExpenseCategories = []defaultCategory{
		{Name: "Продукты"},
		{Name: "Кафе и рестораны"},
		{Name: "Транспорт", Children: []string{"Общественный транспорт", "Такси"}},
		{Name: "Автомобиль", Children: []string{"Топливо", "Обслуживание", "Парковка"}},
		{Name: "Жильё", Children: []string{"Аренда и ипотека", "Коммунальные услуги", "Ремонт"}},
		{Name: "Связь и интернет"},
		{Name: "Здоровье", Children: []string{"Аптека", "Врачи"}},
		{Name: "Одежда и обувь"},
		{Name: "Дом и быт"},
		{Name: "Дети"},
		{Name: "Развлечения", Children: []string{"Кино и театр", "Хобби"}},
		{Name: "Подписки"},
		{Name: "Красота и уход"},
		{Name: "Образование"},
		{Name: "Подарки"},
		{Name: "Путешествия"},
		{Name: "Прочие расходы"},
	}
	defaultIncomeCategories = []defaultCategory{
		{Name: "Зарплата"},
		{Name: "Подработка"},
		{Name: "Проценты и кешбэк"},
		{Name: "Подарки"},
		{Name: "Прочее"},
	}
)

// defaultCategoryRows разворачивает наборы в строки для вставки: родитель
// идёт раньше подкатегорий, id задаём сами, чтобы сослаться на родителя.
// Это не «глобальное состояние», а константные данные: срезы только читаются.
func defaultCategoryRows(familyID uuid.UUID) ([]dbgen.CreateCategoryParams, error) {
	var rows []dbgen.CreateCategoryParams
	add := func(kind dbgen.CategoryKind, parent *uuid.UUID, name string, order int) (uuid.UUID, error) {
		id, err := uuid.NewV7() // v7, как uuidv7() в БД: упорядочен по времени
		if err != nil {
			return uuid.Nil, err
		}
		rows = append(rows, dbgen.CreateCategoryParams{
			ID: id, FamilyID: familyID, Kind: kind, ParentID: parent, Name: name, SortOrder: int32(order),
		})
		return id, nil
	}
	// Срез, а не map: порядок обхода map в Go случаен, а id v7 удобнее
	// получать в предсказуемом порядке.
	sets := []struct {
		kind dbgen.CategoryKind
		list []defaultCategory
	}{
		{dbgen.CategoryKindExpense, defaultExpenseCategories},
		{dbgen.CategoryKindIncome, defaultIncomeCategories},
	}
	for _, set := range sets {
		kind := set.kind
		for i, c := range set.list {
			parentID, err := add(kind, nil, c.Name, i+1)
			if err != nil {
				return nil, err
			}
			for j, child := range c.Children {
				if _, err := add(kind, &parentID, child, j+1); err != nil {
					return nil, err
				}
			}
		}
	}
	return rows, nil
}

// createDefaultCategories вставляет набор категорий семьи одним пакетом запросов.
func createDefaultCategories(ctx context.Context, q *dbgen.Queries, familyID uuid.UUID) error {
	rows, err := defaultCategoryRows(familyID)
	if err != nil {
		return fmt.Errorf("default categories: %w", err)
	}
	var batchErr error
	// Exec вызывает функцию для каждого запроса пакета; запоминаем первую ошибку.
	q.CreateCategory(ctx, rows).Exec(func(i int, err error) {
		if err != nil && batchErr == nil {
			batchErr = fmt.Errorf("create default category %q: %w", rows[i].Name, err)
		}
	})
	return batchErr
}
