package firestore

import (
	"context"
	"fmt"
	"log"

	googlefirestore "cloud.google.com/go/firestore"
	"github.com/andyathsid/backend/internal/domain"
)

func (fs *FirestoreClient) AddUserMessage(ctx context.Context, message domain.Message, lastMessage domain.LastMessage) error {
	chatRef := fs.Client.Collection("chats").Doc(message.ChatID)
	messageRef := chatRef.Collection("messages").Doc(message.ID)
	err := fs.Client.RunTransaction(ctx, func(ctx context.Context, transaction *googlefirestore.Transaction) error {
		chatDocument, err := transaction.Get(chatRef)
		if err != nil {
			return err
		}
		participants := interfaceStringSlice(chatDocument.Data()["participants"])
		if !contains(participants, message.SenderID) {
			return fmt.Errorf("sender is no longer a participant")
		}
		if err := transaction.Create(messageRef, messageData(message)); err != nil {
			return err
		}
		if err := transaction.Update(chatRef, []googlefirestore.Update{
			{Path: "lastMessage", Value: lastMessageData(lastMessage)},
			{Path: "updatedAt", Value: message.CreatedAt},
		}); err != nil {
			return err
		}
		for _, participantID := range participants {
			if participantID == message.SenderID {
				continue
			}
			if err := transaction.Set(chatRef.Collection("members").Doc(participantID), map[string]any{
				"chatId": message.ChatID, "uid": participantID, "hasUnread": true,
				"unreadCount": googlefirestore.Increment(1), "lastUnreadAt": message.CreatedAt,
				"latestUnreadMessageId": message.ID,
			}, googlefirestore.MergeAll); err != nil {
				return err
			}
		}
		return nil
	})
	return mapFirestoreError(err)
}

func (fs *FirestoreClient) GetMessage(ctx context.Context, chatID, messageID string) (domain.Message, error) {
	document, err := fs.Client.Collection("chats").Doc(chatID).Collection("messages").Doc(messageID).Get(ctx)
	if err != nil {
		return domain.Message{}, mapFirestoreError(err)
	}
	return messageFromData(chatID, document.Ref.ID, document.Data()), nil
}

func (fs *FirestoreClient) GetMessages(ctx context.Context, chatID string, messageIDs []string) ([]domain.Message, error) {
	if len(messageIDs) == 0 {
		return nil, nil
	}
	messagesRef := fs.Client.Collection("chats").Doc(chatID).Collection("messages")
	refs := make([]*googlefirestore.DocumentRef, len(messageIDs))
	for index, messageID := range messageIDs {
		refs[index] = messagesRef.Doc(messageID)
	}
	documents, err := fs.Client.GetAll(ctx, refs)
	if err != nil {
		return nil, mapFirestoreError(err)
	}
	messages := make([]domain.Message, 0, len(documents))
	for _, document := range documents {
		if document.Exists() {
			messages = append(messages, messageFromData(chatID, document.Ref.ID, document.Data()))
		}
	}
	return messages, nil
}

func (fs *FirestoreClient) DeleteMessage(ctx context.Context, chatID, messageID string) error {
	_, err := fs.Client.Collection("chats").Doc(chatID).Collection("messages").Doc(messageID).Delete(ctx)
	return mapFirestoreError(err)
}

func (fs *FirestoreClient) MarkMessagesDelivered(ctx context.Context, chatID string, messageIDs []string, userID string) error {
	return fs.updateReceipts(ctx, chatID, messageIDs, userID, "deliveredTo")
}

func (fs *FirestoreClient) MarkMessagesRead(ctx context.Context, chatID string, messageIDs []string, userID string) error {
	return fs.updateReceipts(ctx, chatID, messageIDs, userID, "readBy")
}

func (fs *FirestoreClient) updateReceipts(ctx context.Context, chatID string, messageIDs []string, userID, field string) error {
	if len(messageIDs) == 0 {
		return nil
	}
	messagesRef := fs.Client.Collection("chats").Doc(chatID).Collection("messages")
	err := fs.runAtomic(ctx, func(transaction *googlefirestore.Transaction) error {
		for _, messageID := range messageIDs {
			if err := transaction.Update(messagesRef.Doc(messageID), []googlefirestore.Update{
				{FieldPath: []string{field, userID}, Value: googlefirestore.ServerTimestamp},
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		log.Printf("[firestore] receipt update failed chatId=%s userId=%s field=%s count=%d: %v", chatID, userID, field, len(messageIDs), err)
	}
	return err
}

func (fs *FirestoreClient) ClearUnreadIfCurrent(ctx context.Context, chatID, userID, readThroughMessageID string) (bool, error) {
	if readThroughMessageID == "" {
		return false, nil
	}
	memberRef := fs.Client.Collection("chats").Doc(chatID).Collection("members").Doc(userID)
	cleared := false
	err := fs.Client.RunTransaction(ctx, func(ctx context.Context, transaction *googlefirestore.Transaction) error {
		memberDocument, err := transaction.Get(memberRef)
		if err != nil {
			return err
		}
		if stringValue(memberDocument.Data()["latestUnreadMessageId"]) != readThroughMessageID {
			return nil
		}
		if err := transaction.Update(memberRef, []googlefirestore.Update{
			{Path: "hasUnread", Value: false}, {Path: "unreadCount", Value: 0},
			{Path: "lastUnreadAt", Value: nil}, {Path: "latestUnreadMessageId", Value: nil},
		}); err != nil {
			return err
		}
		cleared = true
		return nil
	})
	return cleared, mapFirestoreError(err)
}

func messageData(message domain.Message) map[string]any {
	data := map[string]any{
		"content": message.Content, "senderId": message.SenderID, "senderName": message.SenderName,
		"senderAvatar": message.SenderAvatar, "createdAt": message.CreatedAt, "type": message.Type,
	}
	if message.MediaURL != "" {
		data["mediaUrl"] = message.MediaURL
		data["mediaPath"] = message.MediaPath
		data["mediaType"] = message.MediaType
		if message.ThumbnailURL != "" {
			data["thumbnailUrl"] = message.ThumbnailURL
			data["thumbnailPath"] = message.ThumbnailPath
		}
		if message.DocumentName != "" {
			data["documentName"] = message.DocumentName
		}
		if message.GroupID != "" {
			data["groupId"] = message.GroupID
			data["groupIndex"] = message.GroupIndex
		}
		if message.MediaWidth > 0 && message.MediaHeight > 0 {
			data["mediaWidth"] = message.MediaWidth
			data["mediaHeight"] = message.MediaHeight
		}
	}
	if message.ReplyToID != nil {
		data["replyToId"] = *message.ReplyToID
	}
	if message.ReplyTo != nil {
		data["replyTo"] = replySnapshotData(*message.ReplyTo)
	}
	return data
}

func lastMessageData(message domain.LastMessage) map[string]any {
	data := map[string]any{
		"id": message.ID, "content": message.Content, "senderId": message.SenderID,
		"senderName": message.SenderName, "senderAvatar": message.SenderAvatar, "createdAt": message.CreatedAt,
	}
	if message.MediaURL != "" {
		data["mediaUrl"] = message.MediaURL
		data["mediaPath"] = message.MediaPath
		data["mediaType"] = message.MediaType
		if message.ThumbnailURL != "" {
			data["thumbnailUrl"] = message.ThumbnailURL
			data["thumbnailPath"] = message.ThumbnailPath
		}
		if message.DocumentName != "" {
			data["documentName"] = message.DocumentName
		}
	}
	return data
}

func replySnapshotData(message domain.Message) map[string]any {
	data := map[string]any{
		"id": message.ID, "content": message.Content, "senderId": message.SenderID,
		"senderName": message.SenderName, "senderAvatar": message.SenderAvatar,
	}
	if message.MediaURL != "" {
		data["mediaUrl"] = message.MediaURL
		data["mediaType"] = message.MediaType
	}
	return data
}

func messageFromData(chatID, messageID string, data map[string]any) domain.Message {
	message := domain.Message{
		ID: messageID, ChatID: chatID, Type: stringValue(data["type"]), Content: stringValue(data["content"]),
		SenderID: stringValue(data["senderId"]), SenderName: stringValue(data["senderName"]),
		SenderAvatar: stringValue(data["senderAvatar"]), CreatedAt: timeValue(data["createdAt"]),
		MediaURL: stringValue(data["mediaUrl"]), MediaPath: stringValue(data["mediaPath"]),
		MediaType: stringValue(data["mediaType"]), MediaWidth: intValue(data["mediaWidth"]),
		MediaHeight: intValue(data["mediaHeight"]), ThumbnailURL: stringValue(data["thumbnailUrl"]),
		ThumbnailPath: stringValue(data["thumbnailPath"]), DocumentName: stringValue(data["documentName"]),
		GroupID: stringValue(data["groupId"]), GroupIndex: intValue(data["groupIndex"]),
		DeliveredTo: mapKeys(data["deliveredTo"]), ReadBy: mapKeys(data["readBy"]),
	}
	if replyID := stringValue(data["replyToId"]); replyID != "" {
		message.ReplyToID = &replyID
	}
	if replyData, ok := data["replyTo"].(map[string]any); ok {
		reply := messageFromData(chatID, stringValue(replyData["id"]), replyData)
		message.ReplyTo = &reply
	}
	return message
}

func intValue(value any) int {
	switch number := value.(type) {
	case int:
		return number
	case int64:
		return int(number)
	case float64:
		return int(number)
	default:
		return 0
	}
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
