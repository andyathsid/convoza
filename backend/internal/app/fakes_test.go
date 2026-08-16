package app

import (
	"context"
	"io"

	"github.com/andyathsid/backend/internal/domain"
)

type fakeUsers struct {
	getByID    func(context.Context, string) (domain.User, error)
	getByEmail func(context.Context, string) (domain.User, error)
	upsert     func(context.Context, *domain.User) error
}

func (f *fakeUsers) GetByID(ctx context.Context, id string) (domain.User, error) {
	if f.getByID != nil {
		return f.getByID(ctx, id)
	}
	return domain.User{}, domain.ErrNotFound
}
func (f *fakeUsers) GetByEmail(ctx context.Context, email string) (domain.User, error) {
	if f.getByEmail != nil {
		return f.getByEmail(ctx, email)
	}
	return domain.User{}, domain.ErrNotFound
}
func (f *fakeUsers) Upsert(ctx context.Context, user *domain.User) error {
	if f.upsert != nil {
		return f.upsert(ctx, user)
	}
	return nil
}
func (f *fakeUsers) GetAll(context.Context, string) ([]domain.User, error) { return nil, nil }
func (f *fakeUsers) SearchByUsername(context.Context, string, string) ([]domain.User, error) {
	return nil, nil
}

type fakeProfiles struct {
	write func(context.Context, domain.User) error
}

func (f *fakeProfiles) WriteUserProfile(ctx context.Context, user domain.User) error {
	if f.write != nil {
		return f.write(ctx, user)
	}
	return nil
}
func (f *fakeProfiles) GetUserProfiles(context.Context, []string) (map[string]domain.UserProfile, error) {
	return nil, nil
}

type fakeChats struct {
	create       func(context.Context, domain.ChatSnapshot, string, *domain.SystemMessage) error
	findDM       func(context.Context, string, string) (domain.ChatSnapshot, error)
	getChat      func(context.Context, string) (domain.ChatSnapshot, error)
	participant  func(context.Context, string, string) (bool, error)
	getMember    func(context.Context, string, string) (domain.Member, error)
	addMembers   func(context.Context, string, []string, string, domain.SystemMessage) error
	removeMember func(context.Context, string, string, string, domain.SystemMessage) error
	setRole      func(context.Context, string, string, string, domain.SystemMessage) error
}

func (f *fakeChats) CreateChat(ctx context.Context, chat domain.ChatSnapshot, creatorID string, message *domain.SystemMessage) error {
	if f.create != nil {
		return f.create(ctx, chat, creatorID, message)
	}
	return nil
}
func (f *fakeChats) UpdateGroupAvatar(context.Context, string, string, string) error { return nil }
func (f *fakeChats) GetChat(ctx context.Context, chatID string) (domain.ChatSnapshot, error) {
	if f.getChat != nil {
		return f.getChat(ctx, chatID)
	}
	return domain.ChatSnapshot{}, domain.ErrNotFound
}
func (f *fakeChats) FindExistingDM(ctx context.Context, first, second string) (domain.ChatSnapshot, error) {
	if f.findDM != nil {
		return f.findDM(ctx, first, second)
	}
	return domain.ChatSnapshot{}, domain.ErrNotFound
}
func (f *fakeChats) IsParticipant(ctx context.Context, chatID, userID string) (bool, error) {
	if f.participant != nil {
		return f.participant(ctx, chatID, userID)
	}
	return false, nil
}
func (f *fakeChats) GetMember(ctx context.Context, chatID, userID string) (domain.Member, error) {
	if f.getMember != nil {
		return f.getMember(ctx, chatID, userID)
	}
	return domain.Member{}, domain.ErrNotFound
}
func (f *fakeChats) AddMembersToChat(ctx context.Context, chatID string, userIDs []string, role string, message domain.SystemMessage) error {
	if f.addMembers != nil {
		return f.addMembers(ctx, chatID, userIDs, role, message)
	}
	return nil
}
func (f *fakeChats) RemoveMemberFromChat(ctx context.Context, chatID, userID, removedBy string, message domain.SystemMessage) error {
	if f.removeMember != nil {
		return f.removeMember(ctx, chatID, userID, removedBy, message)
	}
	return nil
}
func (f *fakeChats) SetMemberRole(ctx context.Context, chatID, userID, role string, message domain.SystemMessage) error {
	if f.setRole != nil {
		return f.setRole(ctx, chatID, userID, role, message)
	}
	return nil
}
func (f *fakeChats) RenameGroup(context.Context, string, string, domain.SystemMessage) error {
	return nil
}

type fakeMessages struct {
	participant func(context.Context, string, string) (bool, error)
	add         func(context.Context, domain.Message, domain.LastMessage) error
	markRead    func(context.Context, string, []string, string) error
	markDeliver func(context.Context, string, []string, string) error
	clearUnread func(context.Context, string, string, string) (bool, error)
}

func (f *fakeMessages) IsParticipant(ctx context.Context, chatID, userID string) (bool, error) {
	if f.participant != nil {
		return f.participant(ctx, chatID, userID)
	}
	return false, nil
}
func (f *fakeMessages) AddUserMessage(ctx context.Context, message domain.Message, last domain.LastMessage) error {
	if f.add != nil {
		return f.add(ctx, message, last)
	}
	return nil
}
func (f *fakeMessages) GetMessage(context.Context, string, string) (domain.Message, error) {
	return domain.Message{}, domain.ErrNotFound
}
func (f *fakeMessages) GetMessages(context.Context, string, []string) ([]domain.Message, error) {
	return nil, nil
}
func (f *fakeMessages) DeleteMessage(context.Context, string, string) error { return nil }
func (f *fakeMessages) MarkMessagesDelivered(ctx context.Context, chatID string, ids []string, userID string) error {
	if f.markDeliver != nil {
		return f.markDeliver(ctx, chatID, ids, userID)
	}
	return nil
}
func (f *fakeMessages) MarkMessagesRead(ctx context.Context, chatID string, ids []string, userID string) error {
	if f.markRead != nil {
		return f.markRead(ctx, chatID, ids, userID)
	}
	return nil
}
func (f *fakeMessages) ClearUnreadIfCurrent(ctx context.Context, chatID, userID, through string) (bool, error) {
	if f.clearUnread != nil {
		return f.clearUnread(ctx, chatID, userID, through)
	}
	return false, nil
}

type fakeObjectStore struct {
	upload func(context.Context, string, string, string, io.Reader) (*StoredObject, error)
	delete func(context.Context, string) error
}

func (f *fakeObjectStore) BucketName() string { return testBucket }
func (f *fakeObjectStore) Inspect(context.Context, string) (*StorageObjectMetadata, error) {
	return nil, nil
}
func (f *fakeObjectStore) Upload(ctx context.Context, path, contentType, token string, source io.Reader) (*StoredObject, error) {
	if f.upload != nil {
		return f.upload(ctx, path, contentType, token, source)
	}
	return &StoredObject{Path: path, DownloadURL: "https://example.test/object"}, nil
}
func (f *fakeObjectStore) Delete(ctx context.Context, path string) error {
	if f.delete != nil {
		return f.delete(ctx, path)
	}
	return nil
}
