package services

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/andyathsid/backend/app/models"
	apprepo "github.com/andyathsid/backend/app/repository"
	firebaseClient "github.com/andyathsid/backend/platform/firebase"
	fsClient "github.com/andyathsid/backend/platform/firestore"
	"github.com/andyathsid/backend/platform/search"
	"github.com/google/uuid"
)

// MessageService contains message business logic.
type MessageService struct {
	users     apprepo.UserRepository
	firestore *fsClient.FirestoreClient
	search    *search.SyncService // nil-safe, Typesense indexing disabled when nil
	storage   firebaseClient.StorageObjectStore
}

// NewMessageService creates a new MessageService.
func NewMessageService(users apprepo.UserRepository, firestore *fsClient.FirestoreClient, searchSync *search.SyncService, storage firebaseClient.StorageObjectStore) *MessageService {
	return &MessageService{users: users, firestore: firestore, search: searchSync, storage: storage}
}

type SentMediaMessage struct {
	ID           string
	MediaURL     string
	ThumbnailURL string
}

func (s *MessageService) SendMediaMessage(ctx context.Context, chatID, userID string, input *models.SendMessageRequest, media StorageUpload, thumbnail *StorageUpload) (*SentMediaMessage, error) {
	isParticipant, err := s.firestore.IsParticipant(ctx, chatID, userID)
	if err != nil || !isParticipant {
		return nil, &ServiceError{Status: http.StatusForbidden, Message: "you are not a participant of this chat"}
	}
	kind, ok := storageKindForMediaType(input.MediaType)
	if !ok {
		return nil, &ServiceError{Status: http.StatusBadRequest, Message: "media type is not allowed"}
	}
	if thumbnail != nil && input.MediaType != "image" && input.MediaType != "video" {
		return nil, &ServiceError{Status: http.StatusBadRequest, Message: "only image and video messages may have thumbnails"}
	}
	mediaObject, err := uploadStorageObject(ctx, s.storage, media, fmt.Sprintf("chats/%s/media/%s/", chatID, userID), kind)
	if err != nil {
		return nil, err
	}
	cleanup := []string{mediaObject.Path}
	committed := false
	defer func() {
		if committed {
			return
		}
		for _, path := range cleanup {
			_ = deleteStorageObject(context.Background(), s.storage, path)
		}
	}()
	input.MediaURL, input.MediaPath = mediaObject.DownloadURL, mediaObject.Path
	if thumbnail != nil {
		thumbnailObject, err := uploadStorageObject(ctx, s.storage, *thumbnail, fmt.Sprintf("chats/%s/thumbnails/%s/", chatID, userID), storageThumbnail)
		if err != nil {
			return nil, err
		}
		cleanup = append(cleanup, thumbnailObject.Path)
		input.ThumbnailURL, input.ThumbnailPath = thumbnailObject.DownloadURL, thumbnailObject.Path
	}
	messageID, err := s.sendMessage(ctx, chatID, userID, input)
	if err != nil {
		return nil, err
	}
	committed = true
	return &SentMediaMessage{ID: messageID, MediaURL: mediaObject.DownloadURL, ThumbnailURL: input.ThumbnailURL}, nil
}

// SendMessage sends a new message to a chat.
func (s *MessageService) SendMessage(ctx context.Context, chatID string, userID string, input *models.SendMessageRequest) (string, error) {
	if input.MediaURL != "" || input.MediaPath != "" || input.MediaType != "" || input.ThumbnailURL != "" || input.ThumbnailPath != "" {
		return "", &ServiceError{Status: http.StatusBadRequest, Message: "media messages must use multipart upload"}
	}
	return s.sendMessage(ctx, chatID, userID, input)
}

func (s *MessageService) sendMessage(ctx context.Context, chatID string, userID string, input *models.SendMessageRequest) (string, error) {
	if input.Content == "" && input.MediaURL == "" {
		return "", &ServiceError{
			Status:  http.StatusBadRequest,
			Message: "message must have content or media",
		}
	}
	// Check participant via Firestore
	isParticipant, err := s.firestore.IsParticipant(ctx, chatID, userID)
	if err != nil || !isParticipant {
		return "", &ServiceError{
			Status:  http.StatusForbidden,
			Message: "you are not a participant of this chat",
		}
	}
	sender, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return "", err
	}

	msgID := uuid.New().String()
	now := time.Now()

	// Write message to Firestore subcollection
	fsMsg := map[string]interface{}{
		"content":      input.Content,
		"senderId":     userID,
		"senderName":   sender.Username,
		"senderAvatar": sender.Avatar,
		"createdAt":    now,
		"type":         "text",
	}

	if input.MediaURL != "" {
		fsMsg["type"] = "media"
		fsMsg["mediaUrl"] = input.MediaURL
		fsMsg["mediaPath"] = input.MediaPath
		fsMsg["mediaType"] = input.MediaType
		if input.ThumbnailURL != "" {
			fsMsg["thumbnailUrl"] = input.ThumbnailURL
			fsMsg["thumbnailPath"] = input.ThumbnailPath
		}
		if input.DocumentName != "" {
			fsMsg["documentName"] = input.DocumentName
		}
		if input.GroupID != "" {
			fsMsg["groupId"] = input.GroupID
			fsMsg["groupIndex"] = input.GroupIndex
		}
		if input.MediaWidth > 0 && input.MediaHeight > 0 {
			fsMsg["mediaWidth"] = input.MediaWidth
			fsMsg["mediaHeight"] = input.MediaHeight
		}
	}

	// Reply-to: read from Firestore subcollection
	if input.ReplyToID != "" {
		fsMsg["replyToId"] = input.ReplyToID
		replyData, err := s.firestore.GetMessage(ctx, chatID, input.ReplyToID)
		if err == nil {
			replyToData := map[string]interface{}{
				"id":       input.ReplyToID,
				"content":  replyData["content"],
				"senderId": replyData["senderId"],
			}
			if mediaUrl, ok := replyData["mediaUrl"].(string); ok && mediaUrl != "" {
				replyToData["mediaUrl"] = mediaUrl
				replyToData["mediaType"] = replyData["mediaType"]
			}
			if name, ok := replyData["senderName"].(string); ok {
				replyToData["senderName"] = name
			}
			if avatar, ok := replyData["senderAvatar"].(string); ok {
				replyToData["senderAvatar"] = avatar
			}
			fsMsg["replyTo"] = replyToData
		}
	}

	lastMsg := map[string]interface{}{
		"id":           msgID,
		"content":      input.Content,
		"senderId":     userID,
		"senderName":   sender.Username,
		"senderAvatar": sender.Avatar,
		"createdAt":    now,
	}
	if input.MediaURL != "" {
		lastMsg["mediaUrl"] = input.MediaURL
		lastMsg["mediaPath"] = input.MediaPath
		lastMsg["mediaType"] = input.MediaType
		if input.ThumbnailURL != "" {
			lastMsg["thumbnailUrl"] = input.ThumbnailURL
			lastMsg["thumbnailPath"] = input.ThumbnailPath
		}
		if input.DocumentName != "" {
			lastMsg["documentName"] = input.DocumentName
		}
	}
	if err := s.firestore.AddUserMessage(ctx, chatID, msgID, userID, fsMsg, lastMsg, now); err != nil {
		return "", err
	}

	// Index only after the authoritative Firestore transaction succeeds.
	if s.search != nil {
		go func() {
			bg := context.Background()
			_ = s.search.IndexMessageFromFirestoreChat(bg, s.firestore, search.MessageIndexDoc{
				ID: msgID, Content: input.Content, SenderID: userID, ChatID: chatID,
				MediaType: input.MediaType, DocumentName: input.DocumentName, CreatedAt: now.UnixMilli(),
			})
			s.search.IndexChatFromFirestore(bg, s.firestore, chatID)
		}()
	}

	return msgID, nil
}

// DeleteMessage deletes a message.
func (s *MessageService) DeleteMessage(ctx context.Context, chatID, messageID, userID string) error {
	// Read from Firestore to check ownership
	msgData, err := s.firestore.GetMessage(ctx, chatID, messageID)
	if err != nil {
		return &ServiceError{Status: http.StatusNotFound, Message: "message not found"}
	}

	senderID, _ := msgData["senderId"].(string)
	if senderID != userID {
		return &ServiceError{Status: http.StatusForbidden, Message: "you can only delete your own messages"}
	}

	if err := s.firestore.DeleteMessage(ctx, chatID, messageID); err != nil {
		return err
	}

	// Unindex message from Typesense
	if s.search != nil {
		go func() {
			bg := context.Background()
			_ = s.search.UnindexMessage(bg, messageID)
		}()
	}

	return nil
}

func (s *MessageService) MarkDelivered(ctx context.Context, chatId, userId string, messageIds []string) error {
	if len(messageIds) == 0 {
		return nil
	}
	if err := s.firestore.MarkMessagesDelivered(ctx, chatId, messageIds, userId); err != nil {
		return err
	}
	if s.search != nil {
		go s.reindexMessages(context.Background(), chatId, messageIds)
	}
	return nil
}

func (s *MessageService) MarkRead(ctx context.Context, chatId, userId string, messageIds []string, readThroughMessageID string) (bool, error) {
	if len(messageIds) > 0 {
		if err := s.firestore.MarkMessagesRead(ctx, chatId, messageIds, userId); err != nil {
			return false, err
		}
	}
	cleared, err := s.firestore.ClearUnreadIfCurrent(ctx, chatId, userId, readThroughMessageID)
	if err != nil {
		return false, err
	}
	if s.search != nil {
		go s.reindexMessages(context.Background(), chatId, messageIds)
	}
	return cleared, nil
}

func (s *MessageService) reindexMessages(ctx context.Context, chatId string, messageIds []string) {
	docs, err := s.firestore.GetMessages(ctx, chatId, messageIds)
	if err != nil {
		return
	}
	for _, data := range docs {
		msgID, _ := data["id"].(string)
		if msgID == "" {
			continue
		}
		deliveredTo := mapKeysToStringSlice(data["deliveredTo"])
		readBy := mapKeysToStringSlice(data["readBy"])
		senderID, _ := data["senderId"].(string)
		mediaType, _ := data["mediaType"].(string)
		content, _ := data["content"].(string)
		var createdAt int64
		if t, ok := data["createdAt"].(time.Time); ok {
			createdAt = t.UnixMilli()
		}
		documentName, _ := data["documentName"].(string)
		_ = s.search.IndexMessageFromFirestoreChat(ctx, s.firestore, search.MessageIndexDoc{
			ID:           msgID,
			Content:      content,
			SenderID:     senderID,
			ChatID:       chatId,
			MediaType:    mediaType,
			DocumentName: documentName,
			CreatedAt:    createdAt,
			DeliveredTo:  deliveredTo,
			ReadBy:       readBy,
		})
	}
}

func mapKeysToStringSlice(v interface{}) []string {
	m, ok := v.(map[string]interface{})
	if !ok || len(m) == 0 {
		return nil
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
