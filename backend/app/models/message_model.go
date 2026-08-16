package models

import "time"

// Message struct to describe Message object.
type Message struct {
	ID            string    `db:"id" json:"id"`
	ChatID        string    `db:"chat_id" json:"chatId"`
	SenderID      string    `db:"sender_id" json:"senderId"`
	Content       string    `db:"content" json:"content"`
	ReplyToID     *string   `db:"reply_to_id" json:"replyToId"`
	MediaURL      string    `db:"media_url" json:"mediaUrl,omitempty"`
	MediaPath     string    `json:"mediaPath,omitempty"`
	MediaType     string    `db:"media_type" json:"mediaType,omitempty"`
	MediaWidth    int       `db:"media_width" json:"mediaWidth,omitempty"`
	MediaHeight   int       `db:"media_height" json:"mediaHeight,omitempty"`
	ThumbnailURL  string    `db:"thumbnail_url" json:"thumbnailUrl,omitempty"`
	ThumbnailPath string    `json:"thumbnailPath,omitempty"`
	DocumentName  string    `db:"document_name" json:"documentName,omitempty"`
	GroupID       string    `db:"group_id" json:"groupId,omitempty"`
	GroupIndex    int       `db:"group_index" json:"groupIndex,omitempty"`
	CreatedAt     time.Time `db:"created_at" json:"createdAt"`
	Sender        *User     `json:"sender,omitempty"`
	ReplyTo       *Message  `json:"replyTo,omitempty"`
}

// SendMessageInput struct for sending a new message.
type SendMessageInput struct {
	ChatID        string `json:"chatId" validate:"required"`
	Content       string `json:"content"`
	ReplyToID     string `json:"replyToId"`
	MediaURL      string `json:"mediaUrl"`
	MediaPath     string `json:"mediaPath"`
	MediaType     string `json:"mediaType"`
	MediaWidth    int    `json:"mediaWidth"`
	MediaHeight   int    `json:"mediaHeight"`
	ThumbnailURL  string `json:"thumbnailUrl"`
	ThumbnailPath string `json:"thumbnailPath"`
	DocumentName  string `json:"documentName"`
	GroupID       string `json:"groupId"`
	GroupIndex    int    `json:"groupIndex"`
}

// SendMessageRequest is an alias for SendMessageInput.
type SendMessageRequest = SendMessageInput

// ReceiptRequest is the request body for marking messages as delivered/read.
type ReceiptRequest struct {
	ChatID               string   `json:"chatId"`
	MessageIDs           []string `json:"messageIds"`
	ReadThroughMessageID string   `json:"readThroughMessageId"`
}
