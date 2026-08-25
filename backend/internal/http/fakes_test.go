package http

import (
	"context"
	"io"
	"time"

	application "github.com/andyathsid/backend/internal/app"
	"github.com/andyathsid/backend/internal/domain"
)

type fakeUserRepository struct {
	getByID func(context.Context, string) (domain.User, error)
	getAll  func(context.Context, string) ([]domain.User, error)
}

func (f *fakeUserRepository) GetByID(ctx context.Context, id string) (domain.User, error) {
	if f.getByID != nil {
		return f.getByID(ctx, id)
	}
	return domain.User{}, domain.ErrNotFound
}
func (f *fakeUserRepository) GetByEmail(context.Context, string) (domain.User, error) {
	return domain.User{}, domain.ErrNotFound
}
func (f *fakeUserRepository) Upsert(context.Context, *domain.User) error { return nil }
func (f *fakeUserRepository) GetAll(ctx context.Context, excludeID string) ([]domain.User, error) {
	if f.getAll != nil {
		return f.getAll(ctx, excludeID)
	}
	return nil, nil
}
func (f *fakeUserRepository) SearchByUsername(context.Context, string, string) ([]domain.User, error) {
	return nil, nil
}

type fakeProfiles struct{}

func (fakeProfiles) WriteUserProfile(context.Context, domain.User) error { return nil }
func (fakeProfiles) GetUserProfiles(context.Context, []string) (map[string]domain.UserProfile, error) {
	return nil, nil
}

type fakeIdentityProvider struct {
	identity application.Identity
	err      error
}

func (f fakeIdentityProvider) VerifyIDToken(context.Context, string) (application.Identity, error) {
	return f.identity, f.err
}
func (f fakeIdentityProvider) CreateSessionCookie(context.Context, string, time.Duration) (string, error) {
	return "session-cookie", f.err
}
func (f fakeIdentityProvider) VerifySessionCookie(context.Context, string) (application.Identity, error) {
	return f.identity, f.err
}
func (f fakeIdentityProvider) GetUser(context.Context, string) (application.Identity, error) {
	return f.identity, f.err
}

type fakeMessageRepository struct {
	participant bool
	added       *domain.Message
}

func (f *fakeMessageRepository) IsParticipant(context.Context, string, string) (bool, error) {
	return f.participant, nil
}
func (f *fakeMessageRepository) AddUserMessage(_ context.Context, message domain.Message, _ domain.LastMessage) error {
	f.added = &message
	return nil
}
func (f *fakeMessageRepository) GetMessage(context.Context, string, string) (domain.Message, error) {
	return domain.Message{}, domain.ErrNotFound
}
func (f *fakeMessageRepository) GetMessages(context.Context, string, []string) ([]domain.Message, error) {
	return nil, nil
}
func (f *fakeMessageRepository) DeleteMessage(context.Context, string, string) error { return nil }
func (f *fakeMessageRepository) MarkMessagesDelivered(context.Context, string, []string, string) error {
	return nil
}
func (f *fakeMessageRepository) MarkMessagesRead(context.Context, string, []string, string) error {
	return nil
}
func (f *fakeMessageRepository) ClearUnreadIfCurrent(context.Context, string, string, string) (bool, error) {
	return true, nil
}

type fakeSearchIndexer struct {
	reindexed string
}

func (f *fakeSearchIndexer) IndexContact(context.Context, domain.User) error { return nil }
func (f *fakeSearchIndexer) IndexChat(context.Context, string) error         { return nil }
func (f *fakeSearchIndexer) IndexMessage(context.Context, application.SearchMessage) error {
	return nil
}
func (f *fakeSearchIndexer) UnindexMessage(context.Context, string) error { return nil }
func (f *fakeSearchIndexer) ReindexUser(_ context.Context, userID string) error {
	f.reindexed = userID
	return nil
}

type fakeObjectStore struct{}

func (fakeObjectStore) BucketName() string { return "chatapp.firebasestorage.app" }
func (fakeObjectStore) Inspect(context.Context, string) (*application.StorageObjectMetadata, error) {
	return nil, nil
}
func (fakeObjectStore) Upload(_ context.Context, path, _, _ string, _ io.Reader) (*application.StoredObject, error) {
	return &application.StoredObject{Path: path, DownloadURL: "https://example.test/media"}, nil
}
func (fakeObjectStore) Delete(context.Context, string) error { return nil }
