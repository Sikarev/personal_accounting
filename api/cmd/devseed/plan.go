package main

import (
	"math/rand/v2"
	"time"

	"personal-accounting/api/internal/oapi"
)

// Ключи счетов в плане; id подставляются после создания счетов.
const (
	accCard     = "card"     // общая карта RUB — зарплата, основные расходы
	accCash     = "cash"     // общие наличные RUB
	accCredit   = "credit"   // общая кредитка RUB с минусом
	accUSD      = "usd"      // общие доллары
	accOld      = "old"      // общая карта, после операций уходит в архив
	accPersonal = "personal" // личная карта владельца
	accMember   = "member"   // личная карта второго участника
)

// historyDays — глубина истории операций: примерно полгода.
const historyDays = 182

// txSpec — операция в плане. Суммы — в минимальных единицах валюты счёта.
type txSpec struct {
	kind     oapi.TransactionInputKind
	account  string
	to       string // перевод: счёт-получатель
	amount   int64
	toAmount int64  // перевод между валютами; 0 — не передаётся
	category string // «вид/имя», см. listCategories
	date     time.Time
	comment  string
}

// expenseKind — вид случайного расхода: категория, вес (частота), диапазон
// суммы в рублях и примеры комментариев.
type expenseKind struct {
	category string
	weight   int
	min, max int
	comments []string
}

var expenseKinds = []expenseKind{
	{"expense/Продукты", 30, 150, 4500, []string{"Пятёрочка", "Перекрёсток", "ВкусВилл; овощи", "Рынок"}},
	{"expense/Кафе и рестораны", 10, 300, 3500, []string{"Обед", "Кофе", "Ужин с друзьями"}},
	{"expense/Такси", 6, 250, 1200, []string{"До работы", "Из гостей"}},
	{"expense/Общественный транспорт", 6, 60, 300, nil},
	{"expense/Топливо", 5, 1500, 4000, []string{"АИ-95"}},
	{"expense/Аптека", 4, 200, 2500, nil},
	{"expense/Врачи", 1, 2000, 6000, []string{"Стоматолог"}},
	{"expense/Одежда и обувь", 3, 1500, 12000, []string{"Кроссовки", "Куртка детям"}},
	{"expense/Дом и быт", 5, 200, 3000, []string{"Бытовая химия", "Лампочки"}},
	{"expense/Развлечения", 2, 300, 3000, nil}, // операции прямо в родителе тоже бывают
	{"expense/Кино и театр", 2, 500, 2500, []string{"Кино", "Театр"}},
	{"expense/Красота и уход", 2, 800, 3500, nil},
	{"expense/Подарки", 2, 1000, 5000, []string{"День рождения коллеги"}},
}

// weightedAccount — счёт случайного расхода и его вес.
type weightedAccount struct {
	key    string
	weight int
}

var expenseAccounts = []weightedAccount{{accCard, 60}, {accCash, 15}, {accCredit, 20}, {accPersonal, 5}}

// buildPlan строит операции владельца: обязательные (зарплата, ежемесячные
// платежи, обмен, перевод «личный → общий», особые комментарии) и случайные
// до общего числа n. Результат зависит только от seed, today и n.
func buildPlan(seed uint64, today time.Time, n int) []txSpec {
	rng := rand.New(rand.NewPCG(seed, seed))
	start := today.AddDate(0, 0, -historyDays)
	var plan []txSpec
	add := func(s txSpec) {
		// Будущие даты API принимает, но в «правдоподобной» истории их нет.
		if !s.date.After(today) && !s.date.Before(start) {
			plan = append(plan, s)
		}
	}
	expense := func(account, category string, amount int64, date time.Time, comment string) txSpec {
		return txSpec{kind: oapi.TransactionInputKindExpense, account: account, amount: amount,
			category: category, date: date, comment: comment}
	}
	transfer := func(from, to string, amount int64, date time.Time, comment string) txSpec {
		return txSpec{kind: oapi.TransactionInputKindTransfer, account: from, to: to, amount: amount,
			date: date, comment: comment}
	}

	// Ежемесячное: зарплата и аванс, ЖКУ, связь, подписки, погашение кредитки.
	for m := 0; m <= historyDays/30+1; m++ {
		month := time.Date(today.Year(), today.Month()-time.Month(m), 1, 0, 0, 0, 0, time.UTC)
		day := func(d int) time.Time { return month.AddDate(0, 0, d-1) }
		add(txSpec{kind: oapi.TransactionInputKindIncome, account: accCard, amount: 4_500_000,
			category: "income/Зарплата", date: day(5), comment: "Аванс"})
		add(txSpec{kind: oapi.TransactionInputKindIncome, account: accCard, amount: 6_500_000,
			category: "income/Зарплата", date: day(20), comment: "Зарплата"})
		add(expense(accCard, "expense/Коммунальные услуги", int64(6500+rng.IntN(3000))*100, day(10), "Квитанция ЖКУ"))
		add(expense(accCredit, "expense/Связь и интернет", 90_000, day(15), "Интернет и мобильная связь"))
		add(expense(accCredit, "expense/Подписки", 39_900, day(15), "Кинопоиск; Яндекс Плюс"))
		add(transfer(accCard, accCredit, 1_500_000, day(25), "Погашение кредитки"))
	}

	d := func(daysAgo int) time.Time { return today.AddDate(0, 0, -daysAgo) }

	// Обмен RUB → USD (перевод между валютами) и траты в долларах.
	exchange := transfer(accCard, accUSD, 920_000, d(40), "Обмен в банке, курс 92")
	exchange.toAmount = 10_000 // 100 $
	add(exchange)
	add(expense(accUSD, "expense/Путешествия", 4_500, d(35), "Отель; Стамбул"))
	add(expense(accUSD, "expense/Путешествия", 1_890, d(34), "Такси из аэропорта"))

	// Перевод «личный → общий»: второй участник видит его со скрытой стороной.
	add(transfer(accPersonal, accCard, 1_000_000, d(20), "Вернул «за продукты»"))
	add(txSpec{kind: oapi.TransactionInputKindIncome, account: accPersonal, amount: 1_200_000,
		category: "income/Подработка", date: d(25), comment: "Перевод по проекту"})

	// Комментарии, на которых ломаются экспорт CSV, поиск и вёрстка:
	// кириллица с «ё», «;», кавычки обоих видов, перенос строки.
	add(expense(accCard, "expense/Продукты", 254_050, d(3), "Пятёрочка; молоко, хлеб, сыр"))
	add(expense(accCash, "expense/Подарки", 300_000, d(9), `Подарок маме "на юбилей" — цветы`))
	add(expense(accCard, "expense/Продукты", 87_000, d(6), "Список:\nхлеб\nмолоко; яйца"))
	add(expense(accCard, "expense/Кафе и рестораны", 412_000, d(14), "Кафе «Ёлки-палки»; чаевые 10%"))

	// Старая карта: несколько трат и перевод остатка — потом счёт уходит в архив.
	add(expense(accOld, "expense/Продукты", 120_000, d(170), "Последние покупки по старой карте"))
	add(expense(accOld, "expense/Транспорт", 60_000, d(165), ""))
	add(transfer(accOld, accCard, 120_000, d(160), "Закрыл старую карту"))

	// Случайные операции до n. Наличные пополняются переводами с карты.
	for range max(0, n-len(plan)) {
		date := d(rng.IntN(historyDays))
		switch p := rng.IntN(100); {
		case p < 85:
			k := pick(rng, expenseKinds, func(k expenseKind) int { return k.weight })
			a := pick(rng, expenseAccounts, func(a weightedAccount) int { return a.weight })
			comment := ""
			if len(k.comments) > 0 && rng.IntN(3) == 0 {
				comment = k.comments[rng.IntN(len(k.comments))]
			}
			plan = append(plan, expense(a.key, k.category, randomAmount(rng, k.min, k.max), date, comment))
		case p < 92:
			plan = append(plan, txSpec{kind: oapi.TransactionInputKindIncome, account: accCard,
				amount: randomAmount(rng, 50, 900), category: "income/Проценты и кешбэк", date: date})
		default:
			plan = append(plan, transfer(accCard, accCash, int64(1+rng.IntN(10))*100_000, date, "Снял наличные"))
		}
	}
	return plan
}

// memberPlan — пара операций второго участника, включая перевод «личный → общий»:
// владелец увидит его на общей карте с counterparty.
func memberPlan(today time.Time) []txSpec {
	d := func(daysAgo int) time.Time { return today.AddDate(0, 0, -daysAgo) }
	return []txSpec{
		{kind: oapi.TransactionInputKindExpense, account: accMember, amount: 185_000,
			category: "expense/Кафе и рестораны", date: d(3), comment: "Кофе с коллегами"},
		{kind: oapi.TransactionInputKindExpense, account: accMember, amount: 234_050,
			category: "expense/Продукты", date: d(1)},
		{kind: oapi.TransactionInputKindExpense, account: accMember, amount: 320_000,
			category: "expense/Красота и уход", date: d(12)},
		{kind: oapi.TransactionInputKindTransfer, account: accMember, to: accCard, amount: 500_000,
			date: d(7), comment: "На общие расходы"},
	}
}

// randomAmount — сумма в копейках от min до max рублей; у каждой четвёртой есть копейки.
func randomAmount(rng *rand.Rand, minRub, maxRub int) int64 {
	amount := int64(minRub+rng.IntN(maxRub-minRub+1)) * 100
	if rng.IntN(4) == 0 {
		amount += int64(rng.IntN(100))
	}
	return amount
}

// pick выбирает элемент с вероятностью, пропорциональной его весу.
func pick[T any](rng *rand.Rand, items []T, weight func(T) int) T {
	total := 0
	for _, it := range items {
		total += weight(it)
	}
	r := rng.IntN(total)
	for _, it := range items {
		if r -= weight(it); r < 0 {
			return it
		}
	}
	return items[len(items)-1]
}
