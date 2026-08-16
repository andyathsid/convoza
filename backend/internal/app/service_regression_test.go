package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/andyathsid/backend/internal/domain"
)

type fakeIdentity struct {
	verify func(context.Context, string) (Identity, error)
}

func (f fakeIdentity) VerifyIDToken(ctx context.Context, token string) (Identity, error) {
	return f.verify(ctx, token)
}
func (f fakeIdentity) GetUser(context.Context, string) (Identity, error) {
	return Identity{}, domain.ErrNotFound
}

func TestAuthServiceDoesNotTreatDependencyFailureAsNewUser(t *testing.T) {
	databaseErr := errors.New("database unavailable")
	users := &fakeUsers{getByID: func(context.Context, string) (domain.User, error) {
		return domain.User{}, databaseErr
	}}
	service := NewAuthService(users, &fakeProfiles{}, fakeIdentity{verify: func(context.Context, string) (Identity, error) {
		return Identity{UID: "alice"}, nil
	}}, NopSearchIndexer{}, nil)

	_, err := service.VerifyAndSyncUser(context.Background(), "token", nil)
	assertServiceCode(t, err, CodeDependencyUnavailable)
}

func TestNewServicesUsesNoopSearchWhenDisabled(t *testing.T) {
	services := NewServices(Dependencies{})
	if _, ok := services.Chat.search.(NopSearchIndexer); !ok {
		t.Fatalf("expected disabled search to use NopSearchIndexer, got %T", services.Chat.search)
	}
	if _, ok := services.Message.search.(NopSearchIndexer); !ok {
		t.Fatalf("expected disabled search to use NopSearchIndexer, got %T", services.Message.search)
	}
}

func TestCreateChatStopsWhenDirectChatLookupFails(t *testing.T) {
	queryErr := errors.New("firestore query unavailable")
	createCalled := false
	chats := &fakeChats{
		findDM: func(context.Context, string, string) (domain.ChatSnapshot, error) {
			return domain.ChatSnapshot{}, queryErr
		},
		create: func(context.Context, domain.ChatSnapshot, string, *domain.SystemMessage) error {
			createCalled = true
			return nil
		},
	}
	service := NewChatService(&fakeUsers{}, chats, NopSearchIndexer{}, &fakeMembershipMirror{}, nil)

	_, err := service.CreateChat(context.Background(), "alice", &CreateChatInput{ParticipantID: "bob"})
	assertServiceCode(t, err, CodeDependencyUnavailable)
	if createCalled {
		t.Fatal("chat creation must not continue after a failed direct-chat lookup")
	}
}

func TestCreateChatCompensatesTypingGrantsWhenFirestoreFails(t *testing.T) {
	users := &fakeUsers{getByID: func(_ context.Context, id string) (domain.User, error) {
		return domain.User{ID: id, Username: id}, nil
	}}
	chats := &fakeChats{
		findDM: func(context.Context, string, string) (domain.ChatSnapshot, error) {
			return domain.ChatSnapshot{}, domain.ErrNotFound
		},
		create: func(context.Context, domain.ChatSnapshot, string, *domain.SystemMessage) error {
			return errors.New("commit failed")
		},
	}
	membership := &fakeMembershipMirror{}
	service := NewChatService(users, chats, NopSearchIndexer{}, membership, nil)

	_, err := service.CreateChat(context.Background(), "alice", &CreateChatInput{ParticipantID: "bob"})
	assertServiceCode(t, err, CodeDependencyUnavailable)
	if len(membership.grants) != 2 || len(membership.revokes) != 2 {
		t.Fatalf("expected both grants to be compensated, grants=%v revokes=%v", membership.grants, membership.revokes)
	}
}

func TestCreatorCannotBeDemoted(t *testing.T) {
	chats := &fakeChats{getMember: func(_ context.Context, _, userID string) (domain.Member, error) {
		return domain.Member{UserID: userID, Role: "creator"}, nil
	}}
	service := NewChatService(&fakeUsers{}, chats, NopSearchIndexer{}, &fakeMembershipMirror{}, nil)

	err := service.DemoteMember(context.Background(), "chat-a", "creator", "creator")
	assertServiceCode(t, err, CodeForbidden)
}

func TestMessageReceiptsRequireParticipant(t *testing.T) {
	writes := 0
	messages := &fakeMessages{
		participant: func(context.Context, string, string) (bool, error) { return false, nil },
		markDeliver: func(context.Context, string, []string, string) error {
			writes++
			return nil
		},
		markRead: func(context.Context, string, []string, string) error {
			writes++
			return nil
		},
	}
	service := NewMessageService(&fakeUsers{}, messages, NopSearchIndexer{}, nil)

	assertServiceCode(t, service.MarkDelivered(context.Background(), "chat-a", "mallory", []string{"message-a"}), CodeForbidden)
	_, err := service.MarkRead(context.Background(), "chat-a", "mallory", []string{"message-a"}, "message-a")
	assertServiceCode(t, err, CodeForbidden)
	if writes != 0 {
		t.Fatalf("unauthorized receipt calls wrote %d times", writes)
	}
}

func TestMediaSendDeletesUploadWhenMessageCommitFails(t *testing.T) {
	deletedPath := ""
	store := &fakeObjectStore{delete: func(_ context.Context, path string) error {
		deletedPath = path
		return nil
	}}
	users := &fakeUsers{getByID: func(_ context.Context, id string) (domain.User, error) {
		return domain.User{ID: id, Username: "Alice"}, nil
	}}
	messages := &fakeMessages{
		participant: func(context.Context, string, string) (bool, error) { return true, nil },
		add: func(context.Context, domain.Message, domain.LastMessage) error {
			return errors.New("commit failed")
		},
	}
	service := NewMessageService(users, messages, NopSearchIndexer{}, store)

	_, err := service.SendMediaMessage(context.Background(), "chat-a", "alice", &SendMessageInput{MediaType: "image"}, StorageUpload{
		Source: strings.NewReader("image"), Size: 5, ContentType: "image/jpeg",
	}, nil)
	assertServiceCode(t, err, CodeDependencyUnavailable)
	if deletedPath == "" {
		t.Fatal("failed message commit must delete the uploaded object")
	}
}

func assertServiceCode(t *testing.T, err error, expected ErrorCode) {
	t.Helper()
	var serviceError *ServiceError
	if !errors.As(err, &serviceError) {
		t.Fatalf("expected ServiceError, got %v", err)
	}
	if serviceError.Code != expected {
		t.Fatalf("expected code %s, got %s", expected, serviceError.Code)
	}
}
