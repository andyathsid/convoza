package app

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/andyathsid/backend/internal/domain"
	"github.com/google/uuid"
)

type ChatService struct {
	users      domain.UserRepository
	chats      domain.ChatRepository
	search     SearchIndexer
	membership MembershipMirror
	storage    ObjectStore
}

func NewChatService(users domain.UserRepository, chats domain.ChatRepository, search SearchIndexer, membership MembershipMirror, storage ObjectStore) *ChatService {
	if search == nil {
		search = NopSearchIndexer{}
	}
	return &ChatService{users: users, chats: chats, search: search, membership: membership, storage: storage}
}

func (s *ChatService) UpdateGroupAvatarUpload(ctx context.Context, chatID, userID string, upload StorageUpload) (*StoredObject, error) {
	chat, err := s.chats.GetChat(ctx, chatID)
	if err != nil {
		return nil, chatReadError("chat not found", err)
	}
	if !chat.IsGroup {
		return nil, InvalidInput("only group chats have group avatars", nil)
	}
	if err := s.requireGroupAdmin(ctx, chatID, userID); err != nil {
		return nil, err
	}
	object, err := uploadStorageObject(ctx, s.storage, upload, fmt.Sprintf("chats/%s/avatar/%s/", chatID, userID), storageAvatar)
	if err != nil {
		return nil, err
	}
	if err := s.chats.UpdateGroupAvatar(ctx, chatID, object.DownloadURL, object.Path); err != nil {
		_ = deleteStorageObject(context.Background(), s.storage, object.Path)
		return nil, DependencyUnavailable("group avatar could not be updated", err)
	}
	if chat.GroupAvatarPath != "" && chat.GroupAvatarPath != object.Path && validateChatStoragePath(chat.GroupAvatarPath, chatID, "avatar") == nil {
		if err := deleteStorageObject(context.Background(), s.storage, chat.GroupAvatarPath); err != nil {
			log.Printf("group avatar cleanup failed chat=%s: %v", chatID, err)
		}
	}
	return object, nil
}

func (s *ChatService) CreateChat(ctx context.Context, userID string, input *CreateChatInput) (*domain.Chat, error) {
	participantIDs, err := requestedParticipantIDs(userID, input)
	if err != nil {
		return nil, err
	}
	if !input.IsGroup {
		existing, findErr := s.chats.FindExistingDM(ctx, userID, input.ParticipantID)
		switch {
		case findErr == nil:
			chat := chatFromSnapshot(existing)
			return &chat, nil
		case !errors.Is(findErr, domain.ErrNotFound):
			return nil, DependencyUnavailable("existing direct chats could not be checked", findErr)
		}
	}

	participants := make([]domain.User, 0, len(participantIDs))
	for _, participantID := range participantIDs {
		user, lookupErr := s.users.GetByID(ctx, participantID)
		if errors.Is(lookupErr, domain.ErrNotFound) {
			return nil, InvalidInput("one or more participants do not exist", lookupErr)
		}
		if lookupErr != nil {
			return nil, DependencyUnavailable("participants could not be loaded", lookupErr)
		}
		participants = append(participants, user)
	}

	chatID := uuid.NewString()
	now := time.Now()
	snapshot := domain.ChatSnapshot{
		ID: chatID, IsGroup: input.IsGroup, GroupName: input.GroupName,
		CreatedBy: userID, Initiator: userID, CreatedAt: now, UpdatedAt: now,
		ParticipantIDs: participantIDs,
	}
	var initialMessage *domain.SystemMessage
	if input.IsGroup {
		creatorName := userNameFromParticipants(participants, userID)
		initialMessage = &domain.SystemMessage{
			ID: uuid.NewString(), Subtype: "group_created",
			Content: creatorName + " created the group", SenderID: userID,
			ActorName: creatorName, CreatedAt: now,
		}
	}

	granted, grantErr := s.grantTypingMemberships(ctx, chatID, participantIDs)
	if grantErr != nil {
		s.compensateTypingGrants(chatID, granted)
		return nil, grantErr
	}
	if err := s.chats.CreateChat(ctx, snapshot, userID, initialMessage); err != nil {
		s.compensateTypingGrants(chatID, granted)
		return nil, DependencyUnavailable("chat could not be created", err)
	}

	go s.indexChat(context.Background(), chatID)
	return &domain.Chat{
		ID: chatID, IsGroup: input.IsGroup, GroupName: input.GroupName,
		CreatedBy: userID, CreatedAt: now, UpdatedAt: now, Participants: participants,
	}, nil
}

func requestedParticipantIDs(userID string, input *CreateChatInput) ([]string, error) {
	if input == nil {
		return nil, InvalidInput("chat input is required", nil)
	}
	if input.IsGroup {
		if input.GroupName == "" || len(input.Participants) == 0 {
			return nil, InvalidInput("group name and participants are required", nil)
		}
		return uniqueStrings(append([]string{userID}, input.Participants...)), nil
	}
	if input.ParticipantID == "" {
		return nil, InvalidInput("participantId is required for 1-on-1 chat", nil)
	}
	if input.ParticipantID == userID {
		return nil, InvalidInput("participantId must identify another user", nil)
	}
	return []string{userID, input.ParticipantID}, nil
}

func (s *ChatService) GetSingleChat(ctx context.Context, chatID, userID string) (*domain.Chat, error) {
	participant, err := s.chats.IsParticipant(ctx, chatID, userID)
	if err != nil {
		return nil, chatReadError("chat not found", err)
	}
	if !participant {
		return nil, Forbidden("you are not a participant of this chat", nil)
	}
	snapshot, err := s.chats.GetChat(ctx, chatID)
	if err != nil {
		return nil, chatReadError("chat not found", err)
	}
	chat := chatFromSnapshot(snapshot)
	return &chat, nil
}

func (s *ChatService) AddMembers(ctx context.Context, chatID, userID string, newMemberIDs []string) error {
	if err := s.requireGroupAdmin(ctx, chatID, userID); err != nil {
		return err
	}
	newMemberIDs = uniqueStrings(newMemberIDs)
	if len(newMemberIDs) == 0 {
		return InvalidInput("at least one member is required", nil)
	}
	for _, memberID := range newMemberIDs {
		existing, membershipErr := s.chats.GetMember(ctx, chatID, memberID)
		if membershipErr == nil && existing.LeftAt == nil {
			return Conflict("one or more users are already members", nil)
		}
		if membershipErr != nil && !errors.Is(membershipErr, domain.ErrNotFound) {
			return DependencyUnavailable("existing membership could not be checked", membershipErr)
		}
		if _, err := s.users.GetByID(ctx, memberID); errors.Is(err, domain.ErrNotFound) {
			return InvalidInput("one or more members do not exist", err)
		} else if err != nil {
			return DependencyUnavailable("members could not be loaded", err)
		}
	}
	actorName := s.getUserName(ctx, userID)
	targetNames := make([]string, 0, len(newMemberIDs))
	for _, memberID := range newMemberIDs {
		targetNames = append(targetNames, s.getUserName(ctx, memberID))
	}
	message := domain.SystemMessage{
		ID: uuid.NewString(), Subtype: "member_added", Content: actorName + " added " + joinNames(targetNames),
		SenderID: userID, ActorName: actorName, TargetIDs: newMemberIDs, CreatedAt: time.Now(),
	}
	granted, err := s.grantTypingMemberships(ctx, chatID, newMemberIDs)
	if err != nil {
		s.compensateTypingGrants(chatID, granted)
		return err
	}
	if err := s.chats.AddMembersToChat(ctx, chatID, newMemberIDs, "member", message); err != nil {
		s.compensateTypingGrants(chatID, granted)
		return DependencyUnavailable("members could not be added", err)
	}
	go s.indexChat(context.Background(), chatID)
	return nil
}

func (s *ChatService) RemoveMember(ctx context.Context, chatID, userID, targetID string) error {
	if err := s.requireGroupAdmin(ctx, chatID, userID); err != nil {
		return err
	}
	target, err := s.activeMember(ctx, chatID, targetID)
	if err != nil {
		return err
	}
	if target.Role == "creator" {
		return Forbidden("cannot remove the group creator", nil)
	}
	actorName := s.getUserName(ctx, userID)
	targetName := s.getUserName(ctx, targetID)
	message := domain.SystemMessage{
		ID: uuid.NewString(), Subtype: "member_removed", Content: actorName + " removed " + targetName,
		SenderID: userID, ActorName: actorName, TargetID: targetID, TargetName: targetName, CreatedAt: time.Now(),
	}
	if err := s.revokeTypingMembership(ctx, chatID, targetID); err != nil {
		return err
	}
	if err := s.chats.RemoveMemberFromChat(ctx, chatID, targetID, userID, message); err != nil {
		s.compensateTypingRevoke(chatID, targetID)
		return DependencyUnavailable("member could not be removed", err)
	}
	go s.indexChat(context.Background(), chatID)
	return nil
}

func (s *ChatService) PromoteMember(ctx context.Context, chatID, userID, targetID string) error {
	if err := s.requireGroupAdmin(ctx, chatID, userID); err != nil {
		return err
	}
	target, err := s.activeMember(ctx, chatID, targetID)
	if err != nil {
		return err
	}
	if target.Role == "creator" || target.Role == "admin" {
		return Conflict("member is already an admin", nil)
	}
	return s.changeMemberRole(ctx, chatID, userID, targetID, "admin", "admin_promoted", " made ", " an admin")
}

func (s *ChatService) DemoteMember(ctx context.Context, chatID, userID, targetID string) error {
	if err := s.requireGroupAdmin(ctx, chatID, userID); err != nil {
		return err
	}
	target, err := s.activeMember(ctx, chatID, targetID)
	if err != nil {
		return err
	}
	if target.Role == "creator" {
		return Forbidden("cannot demote the group creator", nil)
	}
	if target.Role != "admin" {
		return Conflict("member is not an admin", nil)
	}
	return s.changeMemberRole(ctx, chatID, userID, targetID, "member", "admin_demoted", " removed ", " as admin")
}

func (s *ChatService) changeMemberRole(ctx context.Context, chatID, actorID, targetID, role, subtype, verb, suffix string) error {
	actorName := s.getUserName(ctx, actorID)
	targetName := s.getUserName(ctx, targetID)
	message := domain.SystemMessage{
		ID: uuid.NewString(), Subtype: subtype, Content: actorName + verb + targetName + suffix,
		SenderID: actorID, ActorName: actorName, TargetID: targetID, TargetName: targetName, CreatedAt: time.Now(),
	}
	if err := s.chats.SetMemberRole(ctx, chatID, targetID, role, message); err != nil {
		return DependencyUnavailable("member role could not be updated", err)
	}
	return nil
}

func (s *ChatService) LeaveGroup(ctx context.Context, chatID, userID string) error {
	member, err := s.activeMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if member.Role == "creator" {
		return Forbidden("the group creator cannot leave without transferring ownership", nil)
	}
	userName := s.getUserName(ctx, userID)
	message := domain.SystemMessage{
		ID: uuid.NewString(), Subtype: "member_left", Content: userName + " left the group",
		SenderID: userID, ActorName: userName, CreatedAt: time.Now(),
	}
	if err := s.revokeTypingMembership(ctx, chatID, userID); err != nil {
		return err
	}
	if err := s.chats.RemoveMemberFromChat(ctx, chatID, userID, userID, message); err != nil {
		s.compensateTypingRevoke(chatID, userID)
		return DependencyUnavailable("group could not be left", err)
	}
	go s.indexChat(context.Background(), chatID)
	return nil
}

func (s *ChatService) RenameGroup(ctx context.Context, chatID, userID, newName string) error {
	if newName == "" {
		return InvalidInput("group name is required", nil)
	}
	if err := s.requireGroupAdmin(ctx, chatID, userID); err != nil {
		return err
	}
	actorName := s.getUserName(ctx, userID)
	message := domain.SystemMessage{
		ID: uuid.NewString(), Subtype: "group_renamed", Content: actorName + " renamed the group to \"" + newName + "\"",
		SenderID: userID, ActorName: actorName, CreatedAt: time.Now(),
	}
	if err := s.chats.RenameGroup(ctx, chatID, newName, message); err != nil {
		return DependencyUnavailable("group could not be renamed", err)
	}
	go s.indexChat(context.Background(), chatID)
	return nil
}

func (s *ChatService) UpdateGroupAvatar(ctx context.Context, chatID, userID, avatarURL, avatarPath string) error {
	chat, err := s.chats.GetChat(ctx, chatID)
	if err != nil {
		return chatReadError("chat not found", err)
	}
	if !chat.IsGroup {
		return InvalidInput("only group chats have group avatars", nil)
	}
	if err := s.requireGroupAdmin(ctx, chatID, userID); err != nil {
		return err
	}
	avatarPrefix := fmt.Sprintf("chats/%s/avatar/%s/", chatID, userID)
	if err := validateStorageObject(ctx, s.storage, avatarURL, avatarPath, avatarPrefix, storageAvatar); err != nil {
		return err
	}
	if err := s.chats.UpdateGroupAvatar(ctx, chatID, avatarURL, avatarPath); err != nil {
		return DependencyUnavailable("group avatar could not be updated", err)
	}
	return nil
}

func (s *ChatService) grantTypingMembership(ctx context.Context, chatID, userID string) error {
	if s.membership == nil {
		return DependencyUnavailable("typing membership synchronization is unavailable", nil)
	}
	if err := s.membership.Grant(ctx, chatID, userID); err != nil {
		return DependencyUnavailable("typing access could not be granted", err)
	}
	return nil
}

func (s *ChatService) revokeTypingMembership(ctx context.Context, chatID, userID string) error {
	if s.membership == nil {
		return DependencyUnavailable("typing membership synchronization is unavailable", nil)
	}
	if err := s.membership.Revoke(ctx, chatID, userID); err != nil {
		return DependencyUnavailable("member removal blocked because typing access could not be revoked", err)
	}
	return nil
}

func (s *ChatService) grantTypingMemberships(ctx context.Context, chatID string, userIDs []string) ([]string, error) {
	granted := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		if err := s.grantTypingMembership(ctx, chatID, userID); err != nil {
			return granted, err
		}
		granted = append(granted, userID)
	}
	return granted, nil
}

func (s *ChatService) compensateTypingGrants(chatID string, userIDs []string) {
	if s.membership == nil {
		return
	}
	for _, userID := range userIDs {
		if err := s.membership.Revoke(context.Background(), chatID, userID); err != nil {
			log.Printf("typing membership rollback failed chat=%s user=%s: %v", chatID, userID, err)
		}
	}
}

func (s *ChatService) compensateTypingRevoke(chatID, userID string) {
	if s.membership == nil {
		return
	}
	if err := s.membership.Grant(context.Background(), chatID, userID); err != nil {
		log.Printf("typing membership restore failed chat=%s user=%s: %v", chatID, userID, err)
	}
}

func (s *ChatService) requireGroupAdmin(ctx context.Context, chatID, userID string) error {
	member, err := s.activeMember(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if member.Role != "admin" && member.Role != "creator" {
		return Forbidden("only admins can perform this action", nil)
	}
	return nil
}

func (s *ChatService) activeMember(ctx context.Context, chatID, userID string) (domain.Member, error) {
	member, err := s.chats.GetMember(ctx, chatID, userID)
	if errors.Is(err, domain.ErrNotFound) {
		return domain.Member{}, Forbidden("you are not an active member of this group", err)
	}
	if err != nil {
		return domain.Member{}, DependencyUnavailable("group membership could not be checked", err)
	}
	if member.LeftAt != nil {
		return domain.Member{}, Forbidden("you are not an active member of this group", nil)
	}
	return member, nil
}

func (s *ChatService) getUserName(ctx context.Context, userID string) string {
	user, err := s.users.GetByID(ctx, userID)
	if err != nil || user.Username == "" {
		return "Unknown"
	}
	return user.Username
}

func joinNames(names []string) string {
	switch len(names) {
	case 0:
		return ""
	case 1:
		return names[0]
	case 2:
		return names[0] + " and " + names[1]
	default:
		return joinNames(names[:len(names)-1]) + ", and " + names[len(names)-1]
	}
}

func chatFromSnapshot(snapshot domain.ChatSnapshot) domain.Chat {
	chat := domain.Chat{
		ID: snapshot.ID, IsGroup: snapshot.IsGroup, GroupName: snapshot.GroupName,
		CreatedBy: snapshot.CreatedBy, CreatedAt: snapshot.CreatedAt, UpdatedAt: snapshot.UpdatedAt,
	}
	chat.Participants = make([]domain.User, 0, len(snapshot.ParticipantIDs))
	for _, participantID := range snapshot.ParticipantIDs {
		chat.Participants = append(chat.Participants, domain.User{ID: participantID})
	}
	return chat
}

func userNameFromParticipants(participants []domain.User, userID string) string {
	for _, participant := range participants {
		if participant.ID == userID && participant.Username != "" {
			return participant.Username
		}
	}
	return "Someone"
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func chatReadError(message string, err error) error {
	if errors.Is(err, domain.ErrNotFound) {
		return NotFound(message, err)
	}
	return DependencyUnavailable("chat could not be loaded", err)
}

func (s *ChatService) indexChat(ctx context.Context, chatID string) {
	_ = s.search.IndexChat(ctx, chatID)
}
