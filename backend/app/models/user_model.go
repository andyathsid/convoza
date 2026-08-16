package models

import (
	"time"
)

// User struct to describe User object.
type User struct {
	ID        string     `db:"id" json:"id"`
	Email     string     `db:"email" json:"email" validate:"required,email,lte=255"`
	Username  string     `db:"username" json:"username" validate:"required,lte=255"`
	Avatar    string     `db:"avatar" json:"avatar"`
	CreatedAt time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt *time.Time `db:"updated_at" json:"updated_at"`
}
