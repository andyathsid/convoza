package models

// SyncUserRequest struct for syncing Firebase user to PostgreSQL.
type SyncUserRequest struct {
	FirebaseUID string `json:"firebase_uid" validate:"required"`
	Email       string `json:"email" validate:"required,email"`
	Username    string `json:"username" validate:"required,lte=255"`
	Avatar      string `json:"avatar"`
	AvatarPath  string `json:"avatarPath"`
}
