package repository

import (
	"context"

	"github.com/andyathsid/backend/app/models"
)

// UserRepository defines storage operations for users.
type UserRepository interface {
	GetByID(ctx context.Context, id string) (models.User, error)
	GetByEmail(ctx context.Context, email string) (models.User, error)
	Upsert(ctx context.Context, user *models.User) error
	GetAll(ctx context.Context, excludeID string) ([]models.User, error)
	SearchByUsername(ctx context.Context, query string, excludeID string) ([]models.User, error)
}
