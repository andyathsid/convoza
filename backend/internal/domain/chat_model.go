package domain

import "time"

// Chat struct to describe Chat object.
type Chat struct {
	ID           string
	IsGroup      bool
	GroupName    string
	CreatedBy    string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Participants []User
	LastMessage  *Message
}

type ChatSnapshot struct {
	ID              string
	IsGroup         bool
	GroupName       string
	CreatedBy       string
	Initiator       string
	CreatedAt       time.Time
	UpdatedAt       time.Time
	ParticipantIDs  []string
	GroupAvatar     string
	GroupAvatarPath string
}

type Member struct {
	UserID string
	Role   string
	LeftAt *time.Time
}

type SystemMessage struct {
	ID         string
	Subtype    string
	Content    string
	SenderID   string
	ActorName  string
	TargetIDs  []string
	TargetID   string
	TargetName string
	CreatedAt  time.Time
}
