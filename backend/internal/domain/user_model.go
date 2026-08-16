package domain

import (
	"time"
)

// User struct to describe User object.
type User struct {
	ID        string
	Email     string
	Username  string
	Avatar    string
	CreatedAt time.Time
	UpdatedAt *time.Time
}
