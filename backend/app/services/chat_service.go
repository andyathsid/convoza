package services

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/andyathsid/backend/app/models"
	apprepo "github.com/andyathsid/backend/app/repository"
	firebaseClient "github.com/andyathsid/backend/platform/firebase"
	fsClient "github.com/andyathsid/backend/platform/firestore"
	"github.com/andyathsid/backend/platform/search"
	"github.com/google/uuid"
)

// ChatService contains chat business logic.
type ChatService struct {
	users      apprepo.UserRepository
	firestore  *fsClient.FirestoreClient
	search     *search.SyncService // nil-safe, Typesense indexing disabled when nil
	membership firebaseClient.MembershipMirror
	storage    firebaseClient.StorageObjectStore
}

// NewChatService creates a new ChatService.
func NewChatService(users apprepo.UserRepository, firestore *fsClient.FirestoreClient, searchSync *search.SyncService, membership firebaseClient.MembershipMirror, storage firebaseClient.StorageObjectStore) *ChatService {
	return &ChatService{users: users, firestore: firestore, search: searchSync, membership: membership, storage: storage}
}

func (s *ChatService) UpdateGroupAvatarUpload(ctx context.Context, chatID, userID string, upload StorageUpload) (*firebaseClient.StoredObject, error) {
	chat, err := s.firestore.GetChat(ctx, chatID)
	if err != nil {
		return nil, err
	}
	if isGroup, _ := chat["isGroup"].(bool); !isGroup {
		return nil, &ServiceError{Status: http.StatusBadRequest, Message: "only group chats have group avatars"}
	}
	isAdmin, err := s.isGroupAdmin(ctx, chatID, userID)
	if err != nil {
		return nil, err
	}
	if !isAdmin {
		return nil, &ServiceError{Status: http.StatusForbidden, Message: "only admins can update the group avatar"}
	}
	object, err := uploadStorageObject(ctx, s.storage, upload, fmt.Sprintf("chats/%s/avatar/%s/", chatID, userID), storageAvatar)
	if err != nil {
		return nil, err
	}
	if err := s.firestore.UpdateChat(ctx, chatID, map[string]interface{}{"groupAvatar": object.DownloadURL, "groupAvatarPath": object.Path}); err != nil {
		_ = deleteStorageObject(context.Background(), s.storage, object.Path)
		return nil, err
	}
	if oldPath, _ := chat["groupAvatarPath"].(string); oldPath != "" && oldPath != object.Path && validateChatStoragePath(oldPath, chatID, "avatar") == nil {
		if err := deleteStorageObject(context.Background(), s.storage, oldPath); err != nil {
			log.Printf("group avatar cleanup failed chat=%s: %v", chatID, err)
		}
	}
	return object, nil
}

// CreateChat creates a new chat.
func (s *ChatService) CreateChat(ctx context.Context, userID string, input *models.CreateChatInput) (*models.Chat, error) {
	var allParticipantIDs []string

	if input.IsGroup {
		if input.GroupName == "" || len(input.Participants) == 0 {
			return nil, &ServiceError{
				Status:  http.StatusBadRequest,
				Message: "group name and participants are required",
			}
		}
		allParticipantIDs = append([]string{userID}, input.Participants...)
	} else {
		if input.ParticipantID == "" {
			return nil, &ServiceError{
				Status:  http.StatusBadRequest,
				Message: "participantId is required for 1-on-1 chat",
			}
		}

		// Check for existing DM in Firestore
		existingID, existingData, err := s.firestore.FindExistingDM(ctx, userID, input.ParticipantID)
		if err == nil && existingID != "" {
			// Build a minimal Chat from Firestore data
			chat := buildChatFromFirestore(existingID, existingData)
			return &chat, nil
		}

		allParticipantIDs = []string{userID, input.ParticipantID}
	}

	var participants []models.User
	for _, pid := range allParticipantIDs {
		u, err := s.users.GetByID(ctx, pid)
		if err != nil {
			continue
		}
		participants = append(participants, u)
	}

	chatID := uuid.New().String()
	now := time.Now()

	// Write to Firestore only
	participantUIDs := make([]string, len(participants))
	for i, p := range participants {
		participantUIDs[i] = p.ID
	}
	fsData := map[string]interface{}{
		"participants": participantUIDs,
		"isGroup":      input.IsGroup,
		"groupName":    input.GroupName,
		"createdBy":    userID,
		"initiator":    userID,
		"createdAt":    now,
		"updatedAt":    now,
		"lastMessage":  nil,
	}
	if err := s.firestore.CreateChat(ctx, chatID, fsData); err != nil {
		return nil, err
	}

	// Index chat to Typesense
	go s.indexChat(context.Background(), chatID)

	// Every chat needs member documents because they are the per-user unread index.
	if err := s.firestore.CreateMembers(ctx, chatID, userID, participantUIDs); err != nil {
		return nil, err
	}
	for _, participantID := range participantUIDs {
		if err := s.grantTypingMembership(ctx, chatID, participantID); err != nil {
			return nil, err
		}
	}

	if input.IsGroup {
		creatorName := "Someone"
		if u, err := s.users.GetByID(ctx, userID); err == nil && u.Username != "" {
			creatorName = u.Username
		}
		sysMsgID := uuid.New().String()
		sysMsgData := map[string]interface{}{
			"type":      "system",
			"subtype":   "group_created",
			"content":   creatorName + " created the group",
			"senderId":  userID,
			"actorName": creatorName,
			"createdAt": now,
		}
		if err := s.firestore.CreateSystemMessage(ctx, chatID, sysMsgID, sysMsgData); err != nil {
			return nil, err
		}

		// Re-index chat after members + system message
		go s.indexChat(context.Background(), chatID)
	}

	chat := &models.Chat{
		ID:           chatID,
		IsGroup:      input.IsGroup,
		GroupName:    input.GroupName,
		CreatedBy:    userID,
		CreatedAt:    now,
		UpdatedAt:    now,
		Participants: participants,
	}

	return chat, nil
}

// GetSingleChat returns a single chat if the user is a participant.
func (s *ChatService) GetSingleChat(ctx context.Context, chatID string, userID string) (*models.Chat, error) {
	isParticipant, err := s.firestore.IsParticipant(ctx, chatID, userID)
	if err != nil || !isParticipant {
		return nil, &ServiceError{
			Status:  http.StatusForbidden,
			Message: "you are not a participant of this chat",
		}
	}

	data, err := s.firestore.GetChat(ctx, chatID)
	if err != nil {
		return nil, &ServiceError{
			Status:  http.StatusNotFound,
			Message: "chat not found",
		}
	}

	chat := buildChatFromFirestore(chatID, data)
	return &chat, nil
}

// GetAllUsers returns all users except the current user.
func (s *ChatService) GetAllUsers(ctx context.Context, userID string) ([]models.User, error) {
	return s.users.GetAll(ctx, userID)
}

// SearchUsers searches users by username, excluding the current user.
func (s *ChatService) SearchUsers(ctx context.Context, userID string, query string) ([]models.User, error) {
	return s.users.SearchByUsername(ctx, query, userID)
}

// AddMembers adds new members to a group chat. Only admins can add.
func (s *ChatService) AddMembers(ctx context.Context, chatID string, userID string, newMemberIDs []string) error {
	// Verify requester is admin
	isAdmin, err := s.isGroupAdmin(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !isAdmin {
		return &ServiceError{Status: http.StatusForbidden, Message: "only admins can add members"}
	}

	for _, pid := range newMemberIDs {
		if err := s.firestore.AddMemberToChat(ctx, chatID, pid, "member"); err != nil {
			return err
		}
		if err := s.grantTypingMembership(ctx, chatID, pid); err != nil {
			return err
		}
	}

	// Create system message
	actorName := s.getUserName(ctx, userID)
	var targetNames []string
	for _, pid := range newMemberIDs {
		targetNames = append(targetNames, s.getUserName(ctx, pid))
	}
	content := actorName + " added " + joinNames(targetNames)
	sysMsgID := uuid.New().String()
	sysMsgData := map[string]interface{}{
		"type":      "system",
		"subtype":   "member_added",
		"content":   content,
		"senderId":  userID,
		"actorName": actorName,
		"targetIds": newMemberIDs,
		"createdAt": time.Now(),
	}
	if err := s.firestore.CreateSystemMessage(ctx, chatID, sysMsgID, sysMsgData); err != nil {
		return err
	}

	go s.indexChat(context.Background(), chatID)
	return nil
}

// RemoveMember removes a member from a group chat. Only admins can remove non-admins.
func (s *ChatService) RemoveMember(ctx context.Context, chatID string, userID string, targetID string) error {
	// Verify requester is admin
	isAdmin, err := s.isGroupAdmin(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !isAdmin {
		return &ServiceError{Status: http.StatusForbidden, Message: "only admins can remove members"}
	}

	// Cannot remove creator
	targetData, err := s.firestore.GetMember(ctx, chatID, targetID)
	if err != nil {
		return &ServiceError{Status: http.StatusNotFound, Message: "member not found"}
	}
	if role, _ := targetData["role"].(string); role == "creator" {
		return &ServiceError{Status: http.StatusForbidden, Message: "cannot remove the group creator"}
	}

	if err := s.revokeTypingMembership(ctx, chatID, targetID); err != nil {
		return err
	}

	if err := s.firestore.RemoveMemberFromChat(ctx, chatID, targetID, userID); err != nil {
		return &ServiceError{
			Status:  http.StatusBadGateway,
			Message: "typing access was revoked, but member removal could not be completed",
			Err:     err,
		}
	}

	// Create system message
	actorName := s.getUserName(ctx, userID)
	targetName := s.getUserName(ctx, targetID)
	content := actorName + " removed " + targetName
	sysMsgID := uuid.New().String()
	sysMsgData := map[string]interface{}{
		"type":       "system",
		"subtype":    "member_removed",
		"content":    content,
		"senderId":   userID,
		"actorName":  actorName,
		"targetId":   targetID,
		"targetName": targetName,
		"createdAt":  time.Now(),
	}
	if err := s.firestore.CreateSystemMessage(ctx, chatID, sysMsgID, sysMsgData); err != nil {
		return err
	}

	go s.indexChat(context.Background(), chatID)
	return nil
}

// PromoteMember promotes a member to admin. Only admins can promote.
func (s *ChatService) PromoteMember(ctx context.Context, chatID string, userID string, targetID string) error {
	isAdmin, err := s.isGroupAdmin(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !isAdmin {
		return &ServiceError{Status: http.StatusForbidden, Message: "only admins can promote members"}
	}

	if err := s.firestore.PromoteMember(ctx, chatID, targetID); err != nil {
		return err
	}

	actorName := s.getUserName(ctx, userID)
	targetName := s.getUserName(ctx, targetID)
	content := actorName + " made " + targetName + " an admin"
	sysMsgID := uuid.New().String()
	sysMsgData := map[string]interface{}{
		"type":       "system",
		"subtype":    "admin_promoted",
		"content":    content,
		"senderId":   userID,
		"actorName":  actorName,
		"targetId":   targetID,
		"targetName": targetName,
		"createdAt":  time.Now(),
	}
	return s.firestore.CreateSystemMessage(ctx, chatID, sysMsgID, sysMsgData)
}

func (s *ChatService) DemoteMember(ctx context.Context, chatID string, userID string, targetID string) error {
	isAdmin, err := s.isGroupAdmin(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !isAdmin {
		return &ServiceError{Status: http.StatusForbidden, Message: "only admins can demote members"}
	}

	if err := s.firestore.DemoteMember(ctx, chatID, targetID); err != nil {
		return err
	}

	actorName := s.getUserName(ctx, userID)
	targetName := s.getUserName(ctx, targetID)
	content := actorName + " removed " + targetName + " as admin"
	sysMsgID := uuid.New().String()
	sysMsgData := map[string]interface{}{
		"type":       "system",
		"subtype":    "admin_demoted",
		"content":    content,
		"senderId":   userID,
		"actorName":  actorName,
		"targetId":   targetID,
		"targetName": targetName,
		"createdAt":  time.Now(),
	}
	return s.firestore.CreateSystemMessage(ctx, chatID, sysMsgID, sysMsgData)
}

// LeaveGroup removes the current user from a group.
func (s *ChatService) LeaveGroup(ctx context.Context, chatID string, userID string) error {
	if err := s.revokeTypingMembership(ctx, chatID, userID); err != nil {
		return err
	}

	if err := s.firestore.RemoveMemberFromChat(ctx, chatID, userID, userID); err != nil {
		return &ServiceError{
			Status:  http.StatusBadGateway,
			Message: "typing access was revoked, but leaving the group could not be completed",
			Err:     err,
		}
	}

	userName := s.getUserName(ctx, userID)
	content := userName + " left the group"
	sysMsgID := uuid.New().String()
	sysMsgData := map[string]interface{}{
		"type":      "system",
		"subtype":   "member_left",
		"content":   content,
		"senderId":  userID,
		"actorName": userName,
		"createdAt": time.Now(),
	}
	if err := s.firestore.CreateSystemMessage(ctx, chatID, sysMsgID, sysMsgData); err != nil {
		return err
	}

	go s.indexChat(context.Background(), chatID)
	return nil
}

// RenameGroup updates a group's name. Only admins/creators can rename.
func (s *ChatService) RenameGroup(ctx context.Context, chatID string, userID string, newName string) error {
	isAdmin, err := s.isGroupAdmin(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !isAdmin {
		return &ServiceError{Status: http.StatusForbidden, Message: "only admins can rename the group"}
	}

	if err := s.firestore.UpdateChat(ctx, chatID, map[string]interface{}{
		"groupName": newName,
	}); err != nil {
		return err
	}

	actorName := s.getUserName(ctx, userID)
	sysMsgID := uuid.New().String()
	sysMsgData := map[string]interface{}{
		"type":      "system",
		"subtype":   "group_renamed",
		"content":   actorName + " renamed the group to \"" + newName + "\"",
		"senderId":  userID,
		"actorName": actorName,
		"createdAt": time.Now(),
	}
	if err := s.firestore.CreateSystemMessage(ctx, chatID, sysMsgID, sysMsgData); err != nil {
		return err
	}

	go s.indexChat(context.Background(), chatID)
	return nil
}

// UpdateGroupAvatar updates a group's avatar URL. Only admins/creators can update.
func (s *ChatService) UpdateGroupAvatar(ctx context.Context, chatID string, userID string, avatarURL string, avatarPath string) error {
	chat, err := s.firestore.GetChat(ctx, chatID)
	if err != nil {
		return err
	}
	isGroup, _ := chat["isGroup"].(bool)
	if !isGroup {
		return &ServiceError{Status: http.StatusBadRequest, Message: "only group chats have group avatars"}
	}

	isAdmin, err := s.isGroupAdmin(ctx, chatID, userID)
	if err != nil {
		return err
	}
	if !isAdmin {
		return &ServiceError{Status: http.StatusForbidden, Message: "only admins can update the group avatar"}
	}
	avatarPrefix := fmt.Sprintf("chats/%s/avatar/%s/", chatID, userID)
	if err := validateStorageObject(ctx, s.storage, avatarURL, avatarPath, avatarPrefix, storageAvatar); err != nil {
		return err
	}

	return s.firestore.UpdateChat(ctx, chatID, map[string]interface{}{
		"groupAvatar":     avatarURL,
		"groupAvatarPath": avatarPath,
	})
}

func (s *ChatService) grantTypingMembership(ctx context.Context, chatID string, userID string) error {
	if s.membership == nil {
		return &ServiceError{
			Status:  http.StatusBadGateway,
			Message: "typing membership synchronization is unavailable",
		}
	}

	if err := s.membership.Grant(ctx, chatID, userID); err != nil {
		return &ServiceError{
			Status:  http.StatusBadGateway,
			Message: "chat membership was saved, but typing access could not be granted",
			Err:     err,
		}
	}

	return nil
}

func (s *ChatService) revokeTypingMembership(ctx context.Context, chatID string, userID string) error {
	if s.membership == nil {
		return &ServiceError{
			Status:  http.StatusBadGateway,
			Message: "typing membership synchronization is unavailable",
		}
	}

	if err := s.membership.Revoke(ctx, chatID, userID); err != nil {
		return &ServiceError{
			Status:  http.StatusBadGateway,
			Message: "member removal blocked because typing access could not be revoked",
			Err:     err,
		}
	}

	return nil
}

func (s *ChatService) isGroupAdmin(ctx context.Context, chatID string, userID string) (bool, error) {
	data, err := s.firestore.GetMember(ctx, chatID, userID)
	if err != nil {
		return false, &ServiceError{Status: http.StatusForbidden, Message: "you are not a member of this group"}
	}
	role, _ := data["role"].(string)
	return role == "admin" || role == "creator", nil
}

// getUserName fetches a user's username, falling back to "Unknown".
func (s *ChatService) getUserName(ctx context.Context, userID string) string {
	u, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return "Unknown"
	}
	if u.Username == "" {
		return "Unknown"
	}
	return u.Username
}

// joinNames joins a list of names with commas and "and".
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

// buildChatFromFirestore converts Firestore chat data to a models.Chat.
func buildChatFromFirestore(chatID string, data map[string]interface{}) models.Chat {
	chat := models.Chat{ID: chatID}

	if v, ok := data["isGroup"].(bool); ok {
		chat.IsGroup = v
	}
	if v, ok := data["groupName"].(string); ok {
		chat.GroupName = v
	}
	if v, ok := data["createdBy"].(string); ok {
		chat.CreatedBy = v
	}
	if v, ok := data["createdAt"].(time.Time); ok {
		chat.CreatedAt = v
	}
	if v, ok := data["updatedAt"].(time.Time); ok {
		chat.UpdatedAt = v
	}

	participantIDs, _ := data["participants"].([]interface{})
	for _, pid := range participantIDs {
		uid, ok := pid.(string)
		if !ok {
			continue
		}
		chat.Participants = append(chat.Participants, models.User{ID: uid})
	}

	return chat
}

// indexChat indexes a chat to Typesense using the shared helper.
func (s *ChatService) indexChat(ctx context.Context, chatID string) {
	if s.search == nil {
		return
	}
	s.search.IndexChatFromFirestore(ctx, s.firestore, chatID)
}

// ReindexUserSearch refreshes searchable profile fields from Firestore.
func (s *ChatService) ReindexUserSearch(ctx context.Context, userID string) {
	if s.search == nil {
		log.Printf("[search] ReindexUserSearch skipped: search disabled")
		return
	}
	log.Printf("[search] ReindexUserSearch: userID=%s", userID)
	_ = s.search.ReindexUserProfile(ctx, s.firestore, userID)
}
