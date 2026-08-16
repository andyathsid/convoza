package repositories

import (
	"context"
	"log"
	"time"

	"github.com/andyathsid/backend/app/models"
	"github.com/andyathsid/backend/app/repository"
	"github.com/jmoiron/sqlx"
)

type UserRepositorySQL struct {
	db *sqlx.DB
}

func NewUserRepositorySQL(db *sqlx.DB) repository.UserRepository {
	return &UserRepositorySQL{db: db}
}

func (r *UserRepositorySQL) GetByID(ctx context.Context, id string) (models.User, error) {
	var user models.User
	err := r.db.GetContext(ctx, &user, "SELECT id, email, username, avatar, created_at, updated_at FROM users WHERE id = $1", id)
	return user, err
}

func (r *UserRepositorySQL) GetByEmail(ctx context.Context, email string) (models.User, error) {
	var user models.User
	err := r.db.GetContext(ctx, &user, "SELECT id, email, username, avatar, created_at, updated_at FROM users WHERE email = $1", email)
	return user, err
}

func (r *UserRepositorySQL) Upsert(ctx context.Context, user *models.User) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO users (id, email, username, avatar, created_at, updated_at)
		VALUES ($1, $2, $3, $4, NOW(), NOW())
		ON CONFLICT (id) DO UPDATE SET
			email = COALESCE(NULLIF(EXCLUDED.email, ''), users.email),
			username = COALESCE(NULLIF(EXCLUDED.username, ''), users.username),
			avatar = EXCLUDED.avatar,
			updated_at = NOW()
	`, user.ID, user.Email, user.Username, user.Avatar)
	return err
}

func (r *UserRepositorySQL) GetAll(ctx context.Context, excludeID string) ([]models.User, error) {
	var users []models.User
	err := r.db.SelectContext(ctx, &users, "SELECT id, email, username, avatar, created_at, updated_at FROM users WHERE id != $1 ORDER BY username", excludeID)
	return users, err
}

func (r *UserRepositorySQL) SearchByUsername(ctx context.Context, query string, excludeID string) ([]models.User, error) {
	var users []models.User
	start := time.Now()
	err := r.db.SelectContext(ctx, &users, "SELECT id, email, username, avatar, created_at, updated_at FROM users WHERE id != $1 AND username ILIKE $2 ORDER BY username LIMIT 20", excludeID, "%"+query+"%")
	duration := time.Since(start)
	log.Printf("[search:postgres] query=%q duration=%dms results=%d", query, duration.Milliseconds(), len(users))
	return users, err
}
