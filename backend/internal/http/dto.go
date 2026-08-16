package http

import (
	"time"

	"github.com/andyathsid/backend/internal/app"
	"github.com/andyathsid/backend/internal/domain"
)

type syncUserRequest struct {
	FirebaseUID string `json:"firebase_uid"`
	Email       string `json:"email"`
	Username    string `json:"username"`
	Avatar      string `json:"avatar"`
	AvatarPath  string `json:"avatarPath"`
}
type createChatRequest struct {
	ParticipantID string   `json:"participantId"`
	IsGroup       bool     `json:"isGroup"`
	Participants  []string `json:"participants"`
	GroupName     string   `json:"groupName"`
}

func (r createChatRequest) input() *app.CreateChatInput {
	return &app.CreateChatInput{ParticipantID: r.ParticipantID, IsGroup: r.IsGroup, Participants: r.Participants, GroupName: r.GroupName}
}

type addMembersRequest struct {
	UserIDs []string `json:"userIds"`
}
type sendMessageRequest struct {
	ChatID        string `json:"chatId"`
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

func (r sendMessageRequest) input() *app.SendMessageInput {
	return &app.SendMessageInput{ChatID: r.ChatID, Content: r.Content, ReplyToID: r.ReplyToID, MediaURL: r.MediaURL, MediaPath: r.MediaPath, MediaType: r.MediaType, MediaWidth: r.MediaWidth, MediaHeight: r.MediaHeight, ThumbnailURL: r.ThumbnailURL, ThumbnailPath: r.ThumbnailPath, DocumentName: r.DocumentName, GroupID: r.GroupID, GroupIndex: r.GroupIndex}
}

type receiptRequest struct {
	ChatID               string   `json:"chatId"`
	MessageIDs           []string `json:"messageIds"`
	ReadThroughMessageID string   `json:"readThroughMessageId"`
}

type userResponse struct {
	ID        string     `json:"id"`
	Email     string     `json:"email"`
	Username  string     `json:"username"`
	Avatar    string     `json:"avatar"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt *time.Time `json:"updated_at"`
}

func userDTO(user domain.User) userResponse {
	return userResponse{ID: user.ID, Email: user.Email, Username: user.Username, Avatar: user.Avatar, CreatedAt: user.CreatedAt, UpdatedAt: user.UpdatedAt}
}
func usersDTO(users []domain.User) []userResponse {
	result := make([]userResponse, len(users))
	for i, user := range users {
		result[i] = userDTO(user)
	}
	return result
}

type messageResponse struct {
	ID            string           `json:"id"`
	ChatID        string           `json:"chatId"`
	SenderID      string           `json:"senderId"`
	Content       string           `json:"content"`
	ReplyToID     *string          `json:"replyToId"`
	MediaURL      string           `json:"mediaUrl,omitempty"`
	MediaPath     string           `json:"mediaPath,omitempty"`
	MediaType     string           `json:"mediaType,omitempty"`
	MediaWidth    int              `json:"mediaWidth,omitempty"`
	MediaHeight   int              `json:"mediaHeight,omitempty"`
	ThumbnailURL  string           `json:"thumbnailUrl,omitempty"`
	ThumbnailPath string           `json:"thumbnailPath,omitempty"`
	DocumentName  string           `json:"documentName,omitempty"`
	GroupID       string           `json:"groupId,omitempty"`
	GroupIndex    int              `json:"groupIndex,omitempty"`
	CreatedAt     time.Time        `json:"createdAt"`
	Sender        *userResponse    `json:"sender,omitempty"`
	ReplyTo       *messageResponse `json:"replyTo,omitempty"`
}

func messageDTO(message *domain.Message) *messageResponse {
	if message == nil {
		return nil
	}
	result := &messageResponse{ID: message.ID, ChatID: message.ChatID, SenderID: message.SenderID, Content: message.Content, ReplyToID: message.ReplyToID, MediaURL: message.MediaURL, MediaPath: message.MediaPath, MediaType: message.MediaType, MediaWidth: message.MediaWidth, MediaHeight: message.MediaHeight, ThumbnailURL: message.ThumbnailURL, ThumbnailPath: message.ThumbnailPath, DocumentName: message.DocumentName, GroupID: message.GroupID, GroupIndex: message.GroupIndex, CreatedAt: message.CreatedAt, ReplyTo: messageDTO(message.ReplyTo)}
	if message.Sender != nil {
		sender := userDTO(*message.Sender)
		result.Sender = &sender
	}
	return result
}

type chatResponse struct {
	ID           string           `json:"id"`
	IsGroup      bool             `json:"isGroup"`
	GroupName    string           `json:"groupName"`
	CreatedBy    string           `json:"createdBy"`
	CreatedAt    time.Time        `json:"createdAt"`
	UpdatedAt    time.Time        `json:"updatedAt"`
	Participants []userResponse   `json:"participants"`
	LastMessage  *messageResponse `json:"lastMessage,omitempty"`
}

func chatDTO(chat domain.Chat) chatResponse {
	return chatResponse{ID: chat.ID, IsGroup: chat.IsGroup, GroupName: chat.GroupName, CreatedBy: chat.CreatedBy, CreatedAt: chat.CreatedAt, UpdatedAt: chat.UpdatedAt, Participants: usersDTO(chat.Participants), LastMessage: messageDTO(chat.LastMessage)}
}
