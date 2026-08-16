package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/andyathsid/backend/internal/domain"
	"github.com/google/uuid"
)

type MessageService struct {
	users    domain.UserRepository
	messages domain.MessageRepository
	search   SearchIndexer
	storage  ObjectStore
}

func NewMessageService(users domain.UserRepository, messages domain.MessageRepository, search SearchIndexer, storage ObjectStore) *MessageService {
	if search == nil {
		search = NopSearchIndexer{}
	}
	return &MessageService{users: users, messages: messages, search: search, storage: storage}
}

type SentMediaMessage struct {
	ID           string
	MediaURL     string
	ThumbnailURL string
}

func (s *MessageService) SendMediaMessage(ctx context.Context, chatID, userID string, input *SendMessageInput, media StorageUpload, thumbnail *StorageUpload) (*SentMediaMessage, error) {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return nil, err
	}
	kind, ok := storageKindForMediaType(input.MediaType)
	if !ok {
		return nil, InvalidInput("media type is not allowed", nil)
	}
	if thumbnail != nil && input.MediaType != "image" && input.MediaType != "video" {
		return nil, InvalidInput("only image and video messages may have thumbnails", nil)
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
		thumbnailObject, uploadErr := uploadStorageObject(ctx, s.storage, *thumbnail, fmt.Sprintf("chats/%s/thumbnails/%s/", chatID, userID), storageThumbnail)
		if uploadErr != nil {
			return nil, uploadErr
		}
		cleanup = append(cleanup, thumbnailObject.Path)
		input.ThumbnailURL, input.ThumbnailPath = thumbnailObject.DownloadURL, thumbnailObject.Path
	}
	messageID, err := s.sendMessage(ctx, chatID, userID, input, true)
	if err != nil {
		return nil, err
	}
	committed = true
	return &SentMediaMessage{ID: messageID, MediaURL: mediaObject.DownloadURL, ThumbnailURL: input.ThumbnailURL}, nil
}

func (s *MessageService) SendMessage(ctx context.Context, chatID, userID string, input *SendMessageInput) (string, error) {
	if input == nil {
		return "", InvalidInput("message input is required", nil)
	}
	if input.MediaURL != "" || input.MediaPath != "" || input.MediaType != "" || input.ThumbnailURL != "" || input.ThumbnailPath != "" {
		return "", InvalidInput("media messages must use multipart upload", nil)
	}
	return s.sendMessage(ctx, chatID, userID, input, false)
}

func (s *MessageService) sendMessage(ctx context.Context, chatID, userID string, input *SendMessageInput, participantChecked bool) (string, error) {
	if input == nil || input.Content == "" && input.MediaURL == "" {
		return "", InvalidInput("message must have content or media", nil)
	}
	if !participantChecked {
		if err := s.requireParticipant(ctx, chatID, userID); err != nil {
			return "", err
		}
	}
	sender, err := s.users.GetByID(ctx, userID)
	if errors.Is(err, domain.ErrNotFound) {
		return "", NotFound("sender not found", err)
	}
	if err != nil {
		return "", DependencyUnavailable("sender could not be loaded", err)
	}

	messageID := uuid.NewString()
	now := time.Now()
	message := domain.Message{
		ID: messageID, ChatID: chatID, SenderID: userID, SenderName: sender.Username,
		SenderAvatar: sender.Avatar, Content: input.Content, CreatedAt: now, Type: "text",
		MediaURL: input.MediaURL, MediaPath: input.MediaPath, MediaType: input.MediaType,
		MediaWidth: input.MediaWidth, MediaHeight: input.MediaHeight,
		ThumbnailURL: input.ThumbnailURL, ThumbnailPath: input.ThumbnailPath,
		DocumentName: input.DocumentName, GroupID: input.GroupID, GroupIndex: input.GroupIndex,
	}
	if input.MediaURL != "" {
		message.Type = "media"
	}
	if input.ReplyToID != "" {
		replyID := input.ReplyToID
		message.ReplyToID = &replyID
		reply, replyErr := s.messages.GetMessage(ctx, chatID, input.ReplyToID)
		switch {
		case replyErr == nil:
			message.ReplyTo = &reply
		case !errors.Is(replyErr, domain.ErrNotFound):
			return "", DependencyUnavailable("reply target could not be loaded", replyErr)
		}
	}
	lastMessage := domain.LastMessage{
		ID: messageID, Content: input.Content, SenderID: userID, SenderName: sender.Username,
		SenderAvatar: sender.Avatar, CreatedAt: now, MediaURL: input.MediaURL, MediaPath: input.MediaPath,
		MediaType: input.MediaType, ThumbnailURL: input.ThumbnailURL,
		ThumbnailPath: input.ThumbnailPath, DocumentName: input.DocumentName,
	}
	if err := s.messages.AddUserMessage(ctx, message, lastMessage); err != nil {
		return "", DependencyUnavailable("message could not be sent", err)
	}

	searchMessage := SearchMessage{
		ID: messageID, Content: input.Content, SenderID: userID, ChatID: chatID,
		MediaType: input.MediaType, DocumentName: input.DocumentName, CreatedAt: now.UnixMilli(),
	}
	go func() {
		ctx := context.Background()
		_ = s.search.IndexMessage(ctx, searchMessage)
		_ = s.search.IndexChat(ctx, chatID)
	}()
	return messageID, nil
}

func (s *MessageService) DeleteMessage(ctx context.Context, chatID, messageID, userID string) error {
	message, err := s.messages.GetMessage(ctx, chatID, messageID)
	if errors.Is(err, domain.ErrNotFound) {
		return NotFound("message not found", err)
	}
	if err != nil {
		return DependencyUnavailable("message could not be loaded", err)
	}
	if message.SenderID != userID {
		return Forbidden("you can only delete your own messages", nil)
	}
	if err := s.messages.DeleteMessage(ctx, chatID, messageID); err != nil {
		return DependencyUnavailable("message could not be deleted", err)
	}
	go func() { _ = s.search.UnindexMessage(context.Background(), messageID) }()
	return nil
}

func (s *MessageService) MarkDelivered(ctx context.Context, chatID, userID string, messageIDs []string) error {
	if len(messageIDs) == 0 {
		return nil
	}
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return err
	}
	if err := s.messages.MarkMessagesDelivered(ctx, chatID, messageIDs, userID); err != nil {
		return DependencyUnavailable("message delivery could not be recorded", err)
	}
	go s.reindexMessages(context.Background(), chatID, messageIDs)
	return nil
}

func (s *MessageService) MarkRead(ctx context.Context, chatID, userID string, messageIDs []string, readThroughMessageID string) (bool, error) {
	if err := s.requireParticipant(ctx, chatID, userID); err != nil {
		return false, err
	}
	if len(messageIDs) > 0 {
		if err := s.messages.MarkMessagesRead(ctx, chatID, messageIDs, userID); err != nil {
			return false, DependencyUnavailable("message reads could not be recorded", err)
		}
	}
	cleared, err := s.messages.ClearUnreadIfCurrent(ctx, chatID, userID, readThroughMessageID)
	if err != nil {
		return false, DependencyUnavailable("unread state could not be cleared", err)
	}
	go s.reindexMessages(context.Background(), chatID, messageIDs)
	return cleared, nil
}

func (s *MessageService) requireParticipant(ctx context.Context, chatID, userID string) error {
	participant, err := s.messages.IsParticipant(ctx, chatID, userID)
	if errors.Is(err, domain.ErrNotFound) {
		return NotFound("chat not found", err)
	}
	if err != nil {
		return DependencyUnavailable("chat membership could not be checked", err)
	}
	if !participant {
		return Forbidden("you are not a participant of this chat", nil)
	}
	return nil
}

func (s *MessageService) reindexMessages(ctx context.Context, chatID string, messageIDs []string) {
	messages, err := s.messages.GetMessages(ctx, chatID, messageIDs)
	if err != nil {
		return
	}
	for _, message := range messages {
		_ = s.search.IndexMessage(ctx, SearchMessage{
			ID: message.ID, Content: message.Content, SenderID: message.SenderID, ChatID: chatID,
			MediaType: message.MediaType, DocumentName: message.DocumentName,
			CreatedAt: message.CreatedAt.UnixMilli(), DeliveredTo: message.DeliveredTo, ReadBy: message.ReadBy,
		})
	}
}
