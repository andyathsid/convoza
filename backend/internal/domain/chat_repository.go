package domain

import "context"

type ChatRepository interface {
	CreateChat(ctx context.Context, chat ChatSnapshot, creatorID string, initialMessage *SystemMessage) error
	UpdateGroupAvatar(ctx context.Context, chatID, avatarURL, avatarPath string) error
	GetChat(ctx context.Context, chatID string) (ChatSnapshot, error)
	FindExistingDM(ctx context.Context, user1ID, user2ID string) (ChatSnapshot, error)
	IsParticipant(ctx context.Context, chatID, userID string) (bool, error)
	GetMember(ctx context.Context, chatID, userID string) (Member, error)
	AddMembersToChat(ctx context.Context, chatID string, userIDs []string, role string, message SystemMessage) error
	RemoveMemberFromChat(ctx context.Context, chatID, userID, removedBy string, message SystemMessage) error
	SetMemberRole(ctx context.Context, chatID, userID, role string, message SystemMessage) error
	RenameGroup(ctx context.Context, chatID, groupName string, message SystemMessage) error
}
