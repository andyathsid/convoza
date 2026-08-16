package domain

import "time"

// Message struct to describe Message object.
type Message struct {
	ID            string
	ChatID        string
	SenderID      string
	Content       string
	ReplyToID     *string
	MediaURL      string
	MediaPath     string
	MediaType     string
	MediaWidth    int
	MediaHeight   int
	ThumbnailURL  string
	ThumbnailPath string
	DocumentName  string
	GroupID       string
	GroupIndex    int
	CreatedAt     time.Time
	Sender        *User
	ReplyTo       *Message
	Type          string
	SenderName    string
	SenderAvatar  string
	DeliveredTo   []string
	ReadBy        []string
}

type LastMessage struct {
	ID            string
	Content       string
	SenderID      string
	SenderName    string
	SenderAvatar  string
	CreatedAt     time.Time
	MediaURL      string
	MediaPath     string
	MediaType     string
	ThumbnailURL  string
	ThumbnailPath string
	DocumentName  string
}
