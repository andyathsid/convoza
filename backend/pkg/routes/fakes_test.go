package routes

import (
	"context"
	"database/sql"

	"github.com/andyathsid/backend/app/models"
)

type fakeUserRepository struct{}

func (f *fakeUserRepository) GetByID(ctx context.Context, id string) (models.User, error) {
	return models.User{}, sql.ErrNoRows
}

func (f *fakeUserRepository) GetByEmail(ctx context.Context, email string) (models.User, error) {
	return models.User{}, sql.ErrNoRows
}

func (f *fakeUserRepository) Upsert(ctx context.Context, user *models.User) error {
	return nil
}

func (f *fakeUserRepository) GetAll(ctx context.Context, excludeID string) ([]models.User, error) {
	return []models.User{}, nil
}

func (f *fakeUserRepository) SearchByUsername(ctx context.Context, query string, excludeID string) ([]models.User, error) {
	return []models.User{}, nil
}
