// Команда devseed — тестовые данные для ручной проверки против настоящего API.
//
//	go run ./cmd/devseed [-api http://localhost:8080] [-db DATABASE_URL] [-ops 300] [-seed 1]
//	go run ./cmd/devseed -cleanup [-db DATABASE_URL]
//
// Первая форма регистрирует пользователя devseed-<время>@example.com и создаёт
// счета и операции за полгода через HTTP API запущенного сервера — с теми же
// проверками и журналом, что у настоящего пользователя. Напрямую в БД пишется
// только то, чего в API ещё нет: второй участник семьи (приглашений пока нет)
// и подтверждённый e-mail. Печатает логины и готовую cookie для curl.
//
// Вторая форма удаляет всех пользователей devseed-%@example.com и их семьи.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	// Встраивает базу часовых поясов: «сегодня» считается по Europe/Moscow
	// и на Windows без системной базы зон.
	_ "time/tzdata"

	"github.com/jackc/pgx/v5/pgxpool"

	"personal-accounting/api/internal/config"
)

// options — разобранные флаги командной строки.
type options struct {
	api     string
	db      string
	ops     int
	seed    uint64
	cleanup bool
}

const (
	defaultOps  = 300
	defaultSeed = 1
	// maxOps — предел флага -ops: больше для замеров не нужно, а опечатка
	// с лишним нулём не должна часами создавать операции.
	maxOps = 100_000
)

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "devseed:", err)
		os.Exit(1)
	}
}

func parseFlags(args []string) (options, error) {
	var o options
	fs := flag.NewFlagSet("devseed", flag.ContinueOnError)
	fs.StringVar(&o.api, "api", "http://localhost:8080", "адрес запущенного API")
	fs.StringVar(&o.db, "db", "", "строка подключения к БД (по умолчанию — DATABASE_URL, как у cmd/api)")
	fs.IntVar(&o.ops, "ops", defaultOps, "сколько операций создать владельцу (для замеров — тысячи)")
	fs.Uint64Var(&o.seed, "seed", defaultSeed, "зерно случайности: одинаковое зерно — одинаковые данные")
	fs.BoolVar(&o.cleanup, "cleanup", false, "удалить всех пользователей devseed-%@example.com и их семьи")
	if err := fs.Parse(args); err != nil {
		return o, err
	}
	if fs.NArg() > 0 {
		return o, fmt.Errorf("лишние аргументы: %v", fs.Args())
	}
	if o.ops < 0 || o.ops > maxOps {
		return o, fmt.Errorf("-ops: от 0 до %d", maxOps)
	}
	u, err := url.Parse(o.api)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return o, fmt.Errorf("-api: нужен адрес вида http://localhost:8081, получено %q", o.api)
	}
	return o, nil
}

func run(args []string, out io.Writer) error {
	o, err := parseFlags(args)
	if errors.Is(err, flag.ErrHelp) {
		return nil
	}
	if err != nil {
		return err
	}
	if o.db == "" {
		cfg, err := config.Load()
		if err != nil {
			return err
		}
		o.db = cfg.DatabaseURL
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, o.db)
	if err != nil {
		return err
	}
	defer pool.Close()

	if o.cleanup {
		res, err := cleanup(ctx, pool)
		if err != nil {
			return err
		}
		fmt.Fprintf(out, "devseed: удалено пользователей — %d, семей — %d\n", res.users, res.families)
		if res.skipped > 0 {
			fmt.Fprintf(out, "devseed: не удалено пользователей — %d: в их семье есть не-devseed участники\n", res.skipped)
		}
		return nil
	}

	res, err := seed(ctx, pool, o, out)
	if err != nil {
		return err
	}
	printResult(out, o, res)
	return nil
}

func printResult(out io.Writer, o options, r seedResult) {
	fmt.Fprintf(out, "devseed: готово за %s, операций — %d\n", r.duration, r.transactions)
	fmt.Fprintf(out, "  владелец:  %s  пароль %s\n", r.ownerEmail, password)
	fmt.Fprintf(out, "  участник:  %s  пароль %s\n", r.memberEmail, password)
	fmt.Fprintf(out, "  семья:     %s\n", r.familyID)
	fmt.Fprintf(out, "  cookie:    pa_session=%s\n", r.cookie)
	fmt.Fprintf(out, "  curl -s -b 'pa_session=%s' %s/api/v1/accounts\n", r.cookie, o.api)
	fmt.Fprintln(out, "  убрать:    go run ./cmd/devseed -cleanup")
}
