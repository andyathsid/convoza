package firestore

import (
	"context"
	"fmt"
	"log"
	"time"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
)

type FirestoreClient struct {
	Client *firestore.Client
}

type UserProfile struct {
	Username string
	Avatar   string
	Email    string
}

func NewFirestoreClient(app *firebase.App) (*FirestoreClient, error) {
	client, err := app.Firestore(context.Background())
	if err != nil {
		return nil, err
	}
	log.Println("Firestore client initialized successfully")
	return &FirestoreClient{Client: client}, nil
}

func (fs *FirestoreClient) CreateChat(ctx context.Context, chatID string, data map[string]interface{}) error {
	_, err := fs.Client.Collection("chats").Doc(chatID).Set(ctx, data)
	return err
}

func (fs *FirestoreClient) UpdateChat(ctx context.Context, chatID string, data map[string]interface{}) error {
	_, err := fs.Client.Collection("chats").Doc(chatID).Set(ctx, data, firestore.MergeAll)
	return err
}

func (fs *FirestoreClient) AddMessage(ctx context.Context, chatID string, messageID string, data map[string]interface{}) error {
	_, err := fs.Client.Collection("chats").Doc(chatID).Collection("messages").Doc(messageID).Set(ctx, data)
	return err
}

// AddUserMessage keeps list ordering and recipient unread state consistent with the message write.
func (fs *FirestoreClient) AddUserMessage(ctx context.Context, chatID, messageID, senderID string, message, lastMessage map[string]interface{}, createdAt time.Time) error {
	chatRef := fs.Client.Collection("chats").Doc(chatID)
	messageRef := chatRef.Collection("messages").Doc(messageID)

	return fs.Client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		chatDoc, err := tx.Get(chatRef)
		if err != nil {
			return err
		}

		if err := tx.Create(messageRef, message); err != nil {
			return err
		}
		if err := tx.Update(chatRef, []firestore.Update{
			{Path: "lastMessage", Value: lastMessage},
			{Path: "updatedAt", Value: createdAt},
		}); err != nil {
			return err
		}

		participants := interfaceStringSlice(chatDoc.Data()["participants"])
		for _, participantID := range participants {
			if participantID == senderID {
				continue
			}
			memberRef := chatRef.Collection("members").Doc(participantID)
			if err := tx.Set(memberRef, map[string]interface{}{
				"chatId": chatID, "uid": participantID, "hasUnread": true,
				"unreadCount": firestore.Increment(1), "lastUnreadAt": createdAt,
				"latestUnreadMessageId": messageID,
			}, firestore.MergeAll); err != nil {
				return err
			}
		}
		return nil
	})
}

func interfaceStringSlice(value interface{}) []string {
	switch values := value.(type) {
	case []string:
		return values
	case []interface{}:
		result := make([]string, 0, len(values))
		for _, value := range values {
			if text, ok := value.(string); ok {
				result = append(result, text)
			}
		}
		return result
	default:
		return nil
	}
}

func (fs *FirestoreClient) DeleteMessage(ctx context.Context, chatID string, messageID string) error {
	_, err := fs.Client.Collection("chats").Doc(chatID).Collection("messages").Doc(messageID).Delete(ctx)
	return err
}

func (fs *FirestoreClient) UpdateChatLastMessage(ctx context.Context, chatID string, data map[string]interface{}) error {
	docRef := fs.Client.Collection("chats").Doc(chatID)
	// Use Update to replace lastMessage entirely (not merge) and bump updatedAt
	_, err := docRef.Update(ctx, []firestore.Update{
		{Path: "lastMessage", Value: data},
		{Path: "updatedAt", Value: time.Now()},
	})
	return err
}

func (fs *FirestoreClient) SetUser(ctx context.Context, userID string, data map[string]interface{}) error {
	_, err := fs.Client.Collection("users").Doc(userID).Set(ctx, data, firestore.MergeAll)
	return err
}

// WriteUserProfile writes a user profile to the users collection in Firestore.
// This allows frontend clients to resolve participant IDs to names/avatars via real-time listener.
func (fs *FirestoreClient) WriteUserProfile(ctx context.Context, userID string, username string, email string, avatar string) error {
	data := map[string]interface{}{
		"username":  username,
		"email":     email,
		"avatar":    avatar,
		"updatedAt": time.Now(),
	}
	_, err := fs.Client.Collection("users").Doc(userID).Set(ctx, data, firestore.MergeAll)
	return err
}

// GetUserProfiles batches profile reads so search indexing does not depend on
// the current authentication database implementation.
func (fs *FirestoreClient) GetUserProfiles(ctx context.Context, userIDs []string) (map[string]UserProfile, error) {
	profiles := make(map[string]UserProfile, len(userIDs))
	if len(userIDs) == 0 {
		return profiles, nil
	}

	refs := make([]*firestore.DocumentRef, len(userIDs))
	for i, userID := range userIDs {
		refs[i] = fs.Client.Collection("users").Doc(userID)
	}

	docs, err := fs.Client.GetAll(ctx, refs)
	if err != nil {
		return nil, err
	}
	for i, doc := range docs {
		if !doc.Exists() {
			continue
		}
		data := doc.Data()
		profiles[userIDs[i]] = UserProfile{
			Username: stringValue(data["username"]),
			Avatar:   stringValue(data["avatar"]),
			Email:    stringValue(data["email"]),
		}
	}
	return profiles, nil
}

func stringValue(value interface{}) string {
	result, _ := value.(string)
	return result
}

// GetChat reads a chat document from Firestore.
func (fs *FirestoreClient) GetChat(ctx context.Context, chatID string) (map[string]interface{}, error) {
	doc, err := fs.Client.Collection("chats").Doc(chatID).Get(ctx)
	if err != nil {
		return nil, err
	}
	return doc.Data(), nil
}

// FindExistingDM finds an existing DM chat between two users.
// Returns the chat ID and data if found, or an error if no DM exists.
func (fs *FirestoreClient) FindExistingDM(ctx context.Context, user1ID, user2ID string) (string, map[string]interface{}, error) {
	docs, err := fs.Client.Collection("chats").
		Where("participants", "array-contains", user1ID).
		Where("isGroup", "==", false).
		Documents(ctx).GetAll()
	if err != nil {
		return "", nil, err
	}
	for _, doc := range docs {
		data := doc.Data()
		participants, ok := data["participants"].([]interface{})
		if !ok {
			continue
		}
		for _, p := range participants {
			if p.(string) == user2ID {
				return doc.Ref.ID, data, nil
			}
		}
	}
	return "", nil, fmt.Errorf("no existing DM found")
}

// IsParticipant checks if a user is a participant of a chat.
func (fs *FirestoreClient) IsParticipant(ctx context.Context, chatID, userID string) (bool, error) {
	doc, err := fs.Client.Collection("chats").Doc(chatID).Get(ctx)
	if err != nil {
		return false, err
	}
	data := doc.Data()
	participants, ok := data["participants"].([]interface{})
	if !ok {
		return false, nil
	}
	for _, p := range participants {
		if p.(string) == userID {
			return true, nil
		}
	}
	return false, nil
}

// GetMessage reads a message from a chat's messages subcollection.
func (fs *FirestoreClient) GetMessage(ctx context.Context, chatID, messageID string) (map[string]interface{}, error) {
	doc, err := fs.Client.Collection("chats").Doc(chatID).Collection("messages").Doc(messageID).Get(ctx)
	if err != nil {
		return nil, err
	}
	return doc.Data(), nil
}

// GetMessages reads multiple messages from a chat's messages subcollection.
func (fs *FirestoreClient) GetMessages(ctx context.Context, chatID string, messageIDs []string) ([]map[string]interface{}, error) {
	if len(messageIDs) == 0 {
		return nil, nil
	}
	msgsRef := fs.Client.Collection("chats").Doc(chatID).Collection("messages")
	refs := make([]*firestore.DocumentRef, len(messageIDs))
	for i, id := range messageIDs {
		refs[i] = msgsRef.Doc(id)
	}
	docs, err := fs.Client.GetAll(ctx, refs)
	if err != nil {
		return nil, err
	}
	result := make([]map[string]interface{}, 0, len(docs))
	for _, doc := range docs {
		if doc.Exists() {
			data := doc.Data()
			data["id"] = doc.Ref.ID
			result = append(result, data)
		}
	}
	return result, nil
}

// CreateMembers also initializes the per-user unread index used by filtered chat queries.
func (fs *FirestoreClient) CreateMembers(ctx context.Context, chatID string, creatorID string, participantIDs []string) error {
	batch := fs.Client.Batch()
	now := time.Now()

	// Creator gets role "creator"
	batch.Set(
		fs.Client.Collection("chats").Doc(chatID).Collection("members").Doc(creatorID),
		map[string]interface{}{
			"chatId":                chatID,
			"uid":                   creatorID,
			"role":                  "creator",
			"joinedAt":              now,
			"leftAt":                nil,
			"removedBy":             nil,
			"hasUnread":             false,
			"unreadCount":           0,
			"lastUnreadAt":          nil,
			"latestUnreadMessageId": nil,
		},
	)

	// Other participants get role "member"
	for _, pid := range participantIDs {
		if pid == creatorID {
			continue
		}
		batch.Set(
			fs.Client.Collection("chats").Doc(chatID).Collection("members").Doc(pid),
			map[string]interface{}{
				"chatId":                chatID,
				"uid":                   pid,
				"role":                  "member",
				"joinedAt":              now,
				"leftAt":                nil,
				"removedBy":             nil,
				"hasUnread":             false,
				"unreadCount":           0,
				"lastUnreadAt":          nil,
				"latestUnreadMessageId": nil,
			},
		)
	}

	_, err := batch.Commit(ctx)
	return err
}

// CreateSystemMessage writes a system message to a chat's messages subcollection.
func (fs *FirestoreClient) CreateSystemMessage(ctx context.Context, chatID string, messageID string, data map[string]interface{}) error {

	// Write system message to messages subcollection
	_, err := fs.Client.Collection("chats").Doc(chatID).Collection("messages").Doc(messageID).Set(ctx, data)
	if err != nil {
		return err
	}

	// Update the chat's lastMessage field to this system message
	lastMsg := map[string]interface{}{
		"content":   data["content"],
		"senderId":  data["senderId"],
		"createdAt": data["createdAt"],
	}
	err = fs.UpdateChatLastMessage(ctx, chatID, lastMsg)

	return err
}

// GetMember reads a single member document from the members subcollection.
func (fs *FirestoreClient) GetMember(ctx context.Context, chatID, userID string) (map[string]interface{}, error) {
	doc, err := fs.Client.Collection("chats").Doc(chatID).Collection("members").Doc(userID).Get(ctx)
	if err != nil {
		return nil, err
	}
	return doc.Data(), nil
}

// AddMemberToChat adds a single member doc to the members subcollection and updates the chat
// participants array atomically inside a Firestore transaction.
func (fs *FirestoreClient) AddMemberToChat(ctx context.Context, chatID string, userID string, role string) error {
	now := time.Now()
	chatRef := fs.Client.Collection("chats").Doc(chatID)
	memberRef := chatRef.Collection("members").Doc(userID)

	return fs.Client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		// Set member doc
		if err := tx.Set(memberRef, map[string]interface{}{
			"chatId":                chatID,
			"uid":                   userID,
			"role":                  role,
			"joinedAt":              now,
			"leftAt":                nil,
			"removedBy":             nil,
			"hasUnread":             false,
			"unreadCount":           0,
			"lastUnreadAt":          nil,
			"latestUnreadMessageId": nil,
		}); err != nil {
			return err
		}

		// Update participants array
		if err := tx.Update(chatRef, []firestore.Update{
			{Path: "participants", Value: firestore.ArrayUnion(userID)},
			{Path: "updatedAt", Value: now},
		}); err != nil {
			return err
		}

		return nil
	})
}

// RemoveMemberFromChat marks a member as removed and pulls them from the participants array.
func (fs *FirestoreClient) RemoveMemberFromChat(ctx context.Context, chatID string, userID string, removedBy string) error {
	now := time.Now()
	batch := fs.Client.Batch()
	// Mark member as removed
	batch.Update(
		fs.Client.Collection("chats").Doc(chatID).Collection("members").Doc(userID),
		[]firestore.Update{
			{Path: "leftAt", Value: now},
			{Path: "removedBy", Value: removedBy},
		},
	)
	// Remove from participants array
	batch.Update(
		fs.Client.Collection("chats").Doc(chatID),
		[]firestore.Update{
			{Path: "participants", Value: firestore.ArrayRemove(userID)},
			{Path: "updatedAt", Value: now},
		},
	)
	_, err := batch.Commit(ctx)
	return err
}

// PromoteMember updates a member's role to "admin".
func (fs *FirestoreClient) PromoteMember(ctx context.Context, chatID string, userID string) error {
	_, err := fs.Client.Collection("chats").Doc(chatID).Collection("members").Doc(userID).Update(ctx, []firestore.Update{
		{Path: "role", Value: "admin"},
	})
	return err
}

// DemoteMember updates a member's role to "member".
func (fs *FirestoreClient) DemoteMember(ctx context.Context, chatID string, userID string) error {
	_, err := fs.Client.Collection("chats").Doc(chatID).Collection("members").Doc(userID).Update(ctx, []firestore.Update{
		{Path: "role", Value: "member"},
	})
	return err
}

func (fs *FirestoreClient) MarkMessagesDelivered(ctx context.Context, chatId string, messageIds []string, userId string) error {
	if len(messageIds) == 0 {
		return nil
	}
	batch := fs.Client.Batch()
	msgsRef := fs.Client.Collection("chats").Doc(chatId).Collection("messages")
	for _, msgId := range messageIds {
		batch.Update(msgsRef.Doc(msgId), []firestore.Update{
			{Path: "deliveredTo." + userId, Value: firestore.ServerTimestamp},
		})
	}
	_, err := batch.Commit(ctx)
	if err != nil {
		log.Printf("[firestore] MarkMessagesDelivered error chatId=%s userId=%s count=%d: %v", chatId, userId, len(messageIds), err)
	} else {
		log.Printf("[firestore] MarkMessagesDelivered OK chatId=%s userId=%s count=%d", chatId, userId, len(messageIds))
	}
	return err
}

func (fs *FirestoreClient) MarkMessagesRead(ctx context.Context, chatId string, messageIds []string, userId string) error {
	if len(messageIds) == 0 {
		return nil
	}
	batch := fs.Client.Batch()
	msgsRef := fs.Client.Collection("chats").Doc(chatId).Collection("messages")
	for _, msgId := range messageIds {
		batch.Update(msgsRef.Doc(msgId), []firestore.Update{
			{Path: "readBy." + userId, Value: firestore.ServerTimestamp},
		})
	}
	_, err := batch.Commit(ctx)
	if err != nil {
		log.Printf("[firestore] MarkMessagesRead error chatId=%s userId=%s count=%d: %v", chatId, userId, len(messageIds), err)
	} else {
		log.Printf("[firestore] MarkMessagesRead OK chatId=%s userId=%s count=%d", chatId, userId, len(messageIds))
	}
	return err
}

// ClearUnreadIfCurrent avoids clearing a message that arrived after the client opened the chat.
func (fs *FirestoreClient) ClearUnreadIfCurrent(ctx context.Context, chatID, userID, readThroughMessageID string) (bool, error) {
	if readThroughMessageID == "" {
		return false, nil
	}
	memberRef := fs.Client.Collection("chats").Doc(chatID).Collection("members").Doc(userID)
	cleared := false
	err := fs.Client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		memberDoc, err := tx.Get(memberRef)
		if err != nil {
			return err
		}
		latestUnreadMessageID, _ := memberDoc.Data()["latestUnreadMessageId"].(string)
		if latestUnreadMessageID != readThroughMessageID {
			return nil
		}
		if err := tx.Update(memberRef, []firestore.Update{
			{Path: "hasUnread", Value: false},
			{Path: "unreadCount", Value: 0},
			{Path: "lastUnreadAt", Value: nil},
			{Path: "latestUnreadMessageId", Value: nil},
		}); err != nil {
			return err
		}
		cleared = true
		return nil
	})
	return cleared, err
}

func (fs *FirestoreClient) Close() error {
	return fs.Client.Close()
}
