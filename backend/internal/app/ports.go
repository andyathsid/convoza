package app

import (
	"context"
	"io"
	"time"

	"github.com/andyathsid/backend/internal/domain"
)

type Identity struct {
	UID, Email, Name string
	Providers        []IdentityProviderProfile
}
type IdentityProviderProfile struct{ ProviderID, Email, DisplayName, PhotoURL string }
type IdentityProvider interface {
	VerifyIDToken(context.Context, string) (Identity, error)
	CreateSessionCookie(context.Context, string, time.Duration) (string, error)
	VerifySessionCookie(context.Context, string) (Identity, error)
	GetUser(context.Context, string) (Identity, error)
}

type StoredObject struct{ Path, DownloadURL string }
type StorageObjectMetadata struct {
	Path, ContentType string
	Size              int64
	DownloadTokens    []string
}
type StorageInspector interface {
	BucketName() string
	Inspect(context.Context, string) (*StorageObjectMetadata, error)
}
type ObjectStore interface {
	StorageInspector
	Upload(context.Context, string, string, string, io.Reader) (*StoredObject, error)
	Delete(context.Context, string) error
}
type MembershipMirror interface {
	Grant(context.Context, string, string) error
	Revoke(context.Context, string, string) error
}

type SearchMessage struct {
	ID, Content, SenderID, ChatID, MediaType, DocumentName string
	CreatedAt                                              int64
	DeliveredTo, ReadBy                                    []string
}
type SearchIndexer interface {
	IndexContact(context.Context, domain.User) error
	IndexChat(context.Context, string) error
	IndexMessage(context.Context, SearchMessage) error
	UnindexMessage(context.Context, string) error
	ReindexUser(context.Context, string) error
}
type NopSearchIndexer struct{}

func (NopSearchIndexer) IndexContact(context.Context, domain.User) error   { return nil }
func (NopSearchIndexer) IndexChat(context.Context, string) error           { return nil }
func (NopSearchIndexer) IndexMessage(context.Context, SearchMessage) error { return nil }
func (NopSearchIndexer) UnindexMessage(context.Context, string) error      { return nil }
func (NopSearchIndexer) ReindexUser(context.Context, string) error         { return nil }
