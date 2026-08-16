package search

import (
	"context"

	"github.com/andyathsid/backend/internal/app"
	"github.com/andyathsid/backend/internal/domain"
)

type Indexer struct {
	sync     *SyncService
	chats    domain.ChatRepository
	profiles domain.UserProfileRepository
}

func NewIndexer(sync *SyncService, chats domain.ChatRepository, profiles domain.UserProfileRepository) app.SearchIndexer {
	return &Indexer{sync: sync, chats: chats, profiles: profiles}
}
func (i *Indexer) IndexContact(ctx context.Context, user domain.User) error {
	return i.sync.IndexContact(ctx, ContactIndexDoc{ID: user.ID, Username: user.Username})
}
func (i *Indexer) IndexChat(ctx context.Context, chatID string) error {
	return i.sync.IndexChatFromRepositories(ctx, i.chats, i.profiles, chatID)
}
func (i *Indexer) IndexMessage(ctx context.Context, message app.SearchMessage) error {
	return i.sync.IndexMessageFromChat(ctx, i.chats, MessageIndexDoc{ID: message.ID, Content: message.Content, SenderID: message.SenderID, ChatID: message.ChatID, MediaType: message.MediaType, DocumentName: message.DocumentName, CreatedAt: message.CreatedAt, DeliveredTo: message.DeliveredTo, ReadBy: message.ReadBy})
}
func (i *Indexer) UnindexMessage(ctx context.Context, messageID string) error {
	return i.sync.UnindexMessage(ctx, messageID)
}
func (i *Indexer) ReindexUser(ctx context.Context, userID string) error {
	return i.sync.ReindexUserProfile(ctx, i.profiles, userID)
}

var _ app.SearchIndexer = (*Indexer)(nil)
