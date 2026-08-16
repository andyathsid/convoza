package database

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"time"

	"github.com/andyathsid/backend/internal/domain"
	"github.com/jackc/pgconn"
	"github.com/jmoiron/sqlx"
)

type UserRepositorySQL struct {
	db *sqlx.DB
}

var _ domain.UserRepository = (*UserRepositorySQL)(nil)

type userRow struct {
	ID        string     `db:"id"`
	Email     string     `db:"email"`
	Username  string     `db:"username"`
	Avatar    string     `db:"avatar"`
	CreatedAt time.Time  `db:"created_at"`
	UpdatedAt *time.Time `db:"updated_at"`
}

func (r userRow) domainUser() domain.User {
	return domain.User{ID: r.ID, Email: r.Email, Username: r.Username, Avatar: r.Avatar, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
}

func NewUserRepositorySQL(db *sqlx.DB) domain.UserRepository {
	return &UserRepositorySQL{db: db}
}

func (r *UserRepositorySQL) GetByID(ctx context.Context, id string) (domain.User, error) {
	var row userRow
	err := r.db.GetContext(ctx, &row, "SELECT id, email, username, avatar, created_at, updated_at FROM users WHERE id = $1", id)
	return row.domainUser(), mapDatabaseError(err)
}

func (r *UserRepositorySQL) GetByEmail(ctx context.Context, email string) (domain.User, error) {
	var row userRow
	err := r.db.GetContext(ctx, &row, "SELECT id, email, username, avatar, created_at, updated_at FROM users WHERE email = $1", email)
	return row.domainUser(), mapDatabaseError(err)
}

func (r *UserRepositorySQL) Upsert(ctx context.Context, user *domain.User) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO users (id, email, username, avatar, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT (id) DO UPDATE SET
			email = COALESCE(NULLIF(EXCLUDED.email, ''), users.email),
			username = COALESCE(NULLIF(EXCLUDED.username, ''), users.username),
			avatar = EXCLUDED.avatar,
			updated_at = NOW()
	`, user.ID, user.Email, user.Username, user.Avatar)
	return mapDatabaseError(err)
}

func (r *UserRepositorySQL) GetAll(ctx context.Context, excludeID string) ([]domain.User, error) {
	var rows []userRow
	err := r.db.SelectContext(ctx, &rows, "SELECT id, email, username, avatar, created_at, updated_at FROM users WHERE id != $1 ORDER BY username", excludeID)
	return domainUsers(rows), mapDatabaseError(err)
}

func (r *UserRepositorySQL) SearchByUsername(ctx context.Context, query string, excludeID string) ([]domain.User, error) {
	var rows []userRow
	start := time.Now()
	err := r.db.SelectContext(ctx, &rows, "SELECT id, email, username, avatar, created_at, updated_at FROM users WHERE id != $1 AND username ILIKE $2 ORDER BY username LIMIT 20", excludeID, "%"+query+"%")
	duration := time.Since(start)
	log.Printf("[search:postgres] query=%q duration=%dms results=%d", query, duration.Milliseconds(), len(rows))
	return domainUsers(rows), mapDatabaseError(err)
}

func mapDatabaseError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, sql.ErrNoRows) {
		return errors.Join(domain.ErrNotFound, err)
	}
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "23505" {
		return errors.Join(domain.ErrConflict, err)
	}
	return err
}

func domainUsers(rows []userRow) []domain.User {
	users := make([]domain.User, len(rows))
	for i, row := range rows {
		users[i] = row.domainUser()
	}
	return users
}
