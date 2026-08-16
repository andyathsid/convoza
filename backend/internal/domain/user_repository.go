package domain

import (
	"context"
	"errors"
)

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

// UserRepository defines storage operations for users.
type UserRepository interface {
	GetByID(ctx context.Context, id string) (User, error)
	GetByEmail(ctx context.Context, email string) (User, error)
	Upsert(ctx context.Context, user *User) error
	GetAll(ctx context.Context, excludeID string) ([]User, error)
	SearchByUsername(ctx context.Context, query string, excludeID string) ([]User, error)
}

type UserProfile struct {
	UserID   string
	Username string
	Email    string
	Avatar   string
}

type UserProfileRepository interface {
	WriteUserProfile(ctx context.Context, user User) error
	GetUserProfiles(ctx context.Context, userIDs []string) (map[string]UserProfile, error)
}
