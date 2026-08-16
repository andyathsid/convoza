package models

import "time"

// Chat struct to describe Chat object.
type Chat struct {
	ID           string    `db:"id" json:"id"`
	IsGroup      bool      `db:"is_group" json:"isGroup"`
	GroupName    string    `db:"group_name" json:"groupName"`
	CreatedBy    string    `db:"created_by" json:"createdBy"`
	CreatedAt    time.Time `db:"created_at" json:"createdAt"`
	UpdatedAt    time.Time `db:"updated_at" json:"updatedAt"`
	Participants []User    `json:"participants"`
	LastMessage  *Message  `json:"lastMessage,omitempty"`
}

// CreateChatInput struct for creating a new chat.
type CreateChatInput struct {
	ParticipantID string   `json:"participantId"`
	IsGroup       bool     `json:"isGroup"`
	Participants  []string `json:"participants"`
	GroupName     string   `json:"groupName"`
}

// AddMembersInput struct for adding members to a group.
type AddMembersInput struct {
	UserIds []string `json:"userIds"`
}

// CreateChatRequest is an alias for CreateChatInput.
type CreateChatRequest = CreateChatInput
