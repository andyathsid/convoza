package domain

import "context"

type MessageRepository interface {
	IsParticipant(ctx context.Context, chatID, userID string) (bool, error)
	AddUserMessage(ctx context.Context, message Message, lastMessage LastMessage) error
	GetMessage(ctx context.Context, chatID, messageID string) (Message, error)
	GetMessages(ctx context.Context, chatID string, messageIDs []string) ([]Message, error)
	DeleteMessage(ctx context.Context, chatID, messageID string) error
	MarkMessagesDelivered(ctx context.Context, chatID string, messageIDs []string, userID string) error
	MarkMessagesRead(ctx context.Context, chatID string, messageIDs []string, userID string) error
	ClearUnreadIfCurrent(ctx context.Context, chatID, userID, readThroughMessageID string) (bool, error)
}
