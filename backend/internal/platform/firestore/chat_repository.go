package firestore

import (
	"context"
	"time"

	googlefirestore "cloud.google.com/go/firestore"
	"github.com/andyathsid/backend/internal/domain"
)

func (fs *FirestoreClient) CreateChat(ctx context.Context, chat domain.ChatSnapshot, creatorID string, initialMessage *domain.SystemMessage) error {
	chatRef := fs.Client.Collection("chats").Doc(chat.ID)
	chatData := map[string]any{
		"participants": chat.ParticipantIDs, "isGroup": chat.IsGroup, "groupName": chat.GroupName,
		"createdBy": chat.CreatedBy, "initiator": chat.Initiator,
		"createdAt": chat.CreatedAt, "updatedAt": chat.UpdatedAt, "lastMessage": nil,
	}
	if initialMessage != nil {
		chatData["lastMessage"] = systemLastMessage(*initialMessage)
	}
	return fs.runAtomic(ctx, func(transaction *googlefirestore.Transaction) error {
		if err := transaction.Create(chatRef, chatData); err != nil {
			return err
		}
		for _, participantID := range chat.ParticipantIDs {
			role := "member"
			if participantID == creatorID {
				role = "creator"
			}
			if err := transaction.Create(chatRef.Collection("members").Doc(participantID), memberData(chat.ID, participantID, role, chat.CreatedAt)); err != nil {
				return err
			}
		}
		if initialMessage != nil {
			return transaction.Create(chatRef.Collection("messages").Doc(initialMessage.ID), systemMessageData(*initialMessage))
		}
		return nil
	})
}

func (fs *FirestoreClient) UpdateGroupAvatar(ctx context.Context, chatID, avatarURL, avatarPath string) error {
	_, err := fs.Client.Collection("chats").Doc(chatID).Update(ctx, []googlefirestore.Update{
		{Path: "groupAvatar", Value: avatarURL}, {Path: "groupAvatarPath", Value: avatarPath},
	})
	return mapFirestoreError(err)
}

func (fs *FirestoreClient) GetChat(ctx context.Context, chatID string) (domain.ChatSnapshot, error) {
	document, err := fs.Client.Collection("chats").Doc(chatID).Get(ctx)
	if err != nil {
		return domain.ChatSnapshot{}, mapFirestoreError(err)
	}
	return chatSnapshot(document.Ref.ID, document.Data()), nil
}

func (fs *FirestoreClient) FindExistingDM(ctx context.Context, user1ID, user2ID string) (domain.ChatSnapshot, error) {
	documents, err := fs.Client.Collection("chats").
		Where("participants", "array-contains", user1ID).
		Where("isGroup", "==", false).
		Documents(ctx).GetAll()
	if err != nil {
		return domain.ChatSnapshot{}, mapFirestoreError(err)
	}
	for _, document := range documents {
		data := document.Data()
		for _, participantID := range interfaceStringSlice(data["participants"]) {
			if participantID == user2ID {
				return chatSnapshot(document.Ref.ID, data), nil
			}
		}
	}
	return domain.ChatSnapshot{}, domain.ErrNotFound
}

func (fs *FirestoreClient) IsParticipant(ctx context.Context, chatID, userID string) (bool, error) {
	chat, err := fs.GetChat(ctx, chatID)
	if err != nil {
		return false, err
	}
	for _, participantID := range chat.ParticipantIDs {
		if participantID == userID {
			return true, nil
		}
	}
	return false, nil
}

func (fs *FirestoreClient) GetMember(ctx context.Context, chatID, userID string) (domain.Member, error) {
	document, err := fs.Client.Collection("chats").Doc(chatID).Collection("members").Doc(userID).Get(ctx)
	if err != nil {
		return domain.Member{}, mapFirestoreError(err)
	}
	data := document.Data()
	member := domain.Member{UserID: userID, Role: stringValue(data["role"])}
	if leftAt, ok := data["leftAt"].(time.Time); ok {
		member.LeftAt = &leftAt
	}
	return member, nil
}

func (fs *FirestoreClient) AddMembersToChat(ctx context.Context, chatID string, userIDs []string, role string, message domain.SystemMessage) error {
	chatRef := fs.Client.Collection("chats").Doc(chatID)
	return fs.runAtomic(ctx, func(transaction *googlefirestore.Transaction) error {
		for _, userID := range userIDs {
			if err := transaction.Set(chatRef.Collection("members").Doc(userID), memberData(chatID, userID, role, message.CreatedAt)); err != nil {
				return err
			}
		}
		if err := transaction.Create(chatRef.Collection("messages").Doc(message.ID), systemMessageData(message)); err != nil {
			return err
		}
		return transaction.Update(chatRef, []googlefirestore.Update{
			{Path: "participants", Value: googlefirestore.ArrayUnion(stringsToAny(userIDs)...)},
			{Path: "lastMessage", Value: systemLastMessage(message)},
			{Path: "updatedAt", Value: message.CreatedAt},
		})
	})
}

func (fs *FirestoreClient) RemoveMemberFromChat(ctx context.Context, chatID, userID, removedBy string, message domain.SystemMessage) error {
	chatRef := fs.Client.Collection("chats").Doc(chatID)
	return fs.runAtomic(ctx, func(transaction *googlefirestore.Transaction) error {
		if err := transaction.Update(chatRef.Collection("members").Doc(userID), []googlefirestore.Update{
			{Path: "leftAt", Value: message.CreatedAt}, {Path: "removedBy", Value: removedBy},
		}); err != nil {
			return err
		}
		if err := transaction.Create(chatRef.Collection("messages").Doc(message.ID), systemMessageData(message)); err != nil {
			return err
		}
		return transaction.Update(chatRef, []googlefirestore.Update{
			{Path: "participants", Value: googlefirestore.ArrayRemove(userID)},
			{Path: "lastMessage", Value: systemLastMessage(message)},
			{Path: "updatedAt", Value: message.CreatedAt},
		})
	})
}

func (fs *FirestoreClient) SetMemberRole(ctx context.Context, chatID, userID, role string, message domain.SystemMessage) error {
	chatRef := fs.Client.Collection("chats").Doc(chatID)
	return fs.runAtomic(ctx, func(transaction *googlefirestore.Transaction) error {
		if err := transaction.Update(chatRef.Collection("members").Doc(userID), []googlefirestore.Update{{Path: "role", Value: role}}); err != nil {
			return err
		}
		if err := transaction.Create(chatRef.Collection("messages").Doc(message.ID), systemMessageData(message)); err != nil {
			return err
		}
		return transaction.Update(chatRef, []googlefirestore.Update{
			{Path: "lastMessage", Value: systemLastMessage(message)}, {Path: "updatedAt", Value: message.CreatedAt},
		})
	})
}

func (fs *FirestoreClient) RenameGroup(ctx context.Context, chatID, groupName string, message domain.SystemMessage) error {
	chatRef := fs.Client.Collection("chats").Doc(chatID)
	return fs.runAtomic(ctx, func(transaction *googlefirestore.Transaction) error {
		if err := transaction.Create(chatRef.Collection("messages").Doc(message.ID), systemMessageData(message)); err != nil {
			return err
		}
		return transaction.Update(chatRef, []googlefirestore.Update{
			{Path: "groupName", Value: groupName}, {Path: "lastMessage", Value: systemLastMessage(message)},
			{Path: "updatedAt", Value: message.CreatedAt},
		})
	})
}

func chatSnapshot(chatID string, data map[string]any) domain.ChatSnapshot {
	return domain.ChatSnapshot{
		ID: chatID, IsGroup: boolValue(data["isGroup"]), GroupName: stringValue(data["groupName"]),
		CreatedBy: stringValue(data["createdBy"]), Initiator: stringValue(data["initiator"]),
		CreatedAt: timeValue(data["createdAt"]), UpdatedAt: timeValue(data["updatedAt"]),
		ParticipantIDs: interfaceStringSlice(data["participants"]), GroupAvatar: stringValue(data["groupAvatar"]),
		GroupAvatarPath: stringValue(data["groupAvatarPath"]),
	}
}

func memberData(chatID, userID, role string, joinedAt time.Time) map[string]any {
	return map[string]any{
		"chatId": chatID, "uid": userID, "role": role, "joinedAt": joinedAt,
		"leftAt": nil, "removedBy": nil, "hasUnread": false, "unreadCount": 0,
		"lastUnreadAt": nil, "latestUnreadMessageId": nil,
	}
}

func systemMessageData(message domain.SystemMessage) map[string]any {
	data := map[string]any{
		"type": "system", "subtype": message.Subtype, "content": message.Content,
		"senderId": message.SenderID, "actorName": message.ActorName, "createdAt": message.CreatedAt,
	}
	if len(message.TargetIDs) > 0 {
		data["targetIds"] = message.TargetIDs
	}
	if message.TargetID != "" {
		data["targetId"] = message.TargetID
	}
	if message.TargetName != "" {
		data["targetName"] = message.TargetName
	}
	return data
}

func systemLastMessage(message domain.SystemMessage) map[string]any {
	return map[string]any{"content": message.Content, "senderId": message.SenderID, "createdAt": message.CreatedAt}
}

func stringsToAny(values []string) []any {
	result := make([]any, len(values))
	for index, value := range values {
		result[index] = value
	}
	return result
}

func timeValue(value any) time.Time {
	result, _ := value.(time.Time)
	return result
}
