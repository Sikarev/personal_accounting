package main

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// emailPattern — шаблон LIKE для всех адресов devseed (владелец и участник).
const emailPattern = "devseed-%@example.com"

type cleanupResult struct {
	users, families int64
	// skipped — devseed-пользователи, которых не удалили: их семья не целиком
	// из devseed (сейчас так не бывает — приглашений нет, но после них возможно).
	skipped int64
}

// cleanup удаляет пользователей devseed и их семьи одной транзакцией.
//
// Порядок важен: accounts.owner_user_id ссылается на users без ON DELETE,
// поэтому пользователя с личным счётом удалить нельзя, пока жив счёт. Сначала
// удаляем семьи — каскадом уходят счета, категории, операции, журнал, участники;
// потом самих пользователей — каскадом их сессии и токены писем.
//
// Семья удаляется, только если все её участники — devseed: чужие данные
// команда не трогает, даже если кто-то пригласил devseed-пользователя к себе.
func cleanup(ctx context.Context, pool *pgxpool.Pool) (cleanupResult, error) {
	var res cleanupResult
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			DELETE FROM families f
			WHERE EXISTS (
			        SELECT 1 FROM family_members m JOIN users u ON u.id = m.user_id
			        WHERE m.family_id = f.id AND u.email LIKE $1)
			  AND NOT EXISTS (
			        SELECT 1 FROM family_members m JOIN users u ON u.id = m.user_id
			        WHERE m.family_id = f.id AND u.email NOT LIKE $1)`, emailPattern)
		if err != nil {
			return err
		}
		res.families = tag.RowsAffected()

		// Пользователь, оставшийся участником чужой семьи (или владельцем
		// личного счёта в ней), пропускается — иначе сломались бы чужие данные
		// или внешний ключ accounts.owner_user_id.
		tag, err = tx.Exec(ctx, `
			DELETE FROM users u
			WHERE u.email LIKE $1
			  AND NOT EXISTS (SELECT 1 FROM family_members m WHERE m.user_id = u.id)
			  AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.owner_user_id = u.id)`, emailPattern)
		if err != nil {
			return err
		}
		res.users = tag.RowsAffected()

		return tx.QueryRow(ctx, `SELECT count(*) FROM users WHERE email LIKE $1`, emailPattern).Scan(&res.skipped)
	})
	return res, err
}
