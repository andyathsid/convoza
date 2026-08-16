package search

import (
	"context"
	"log"

	"github.com/typesense/typesense-go/v3/typesense"
	"github.com/typesense/typesense-go/v3/typesense/api"
	"github.com/typesense/typesense-go/v3/typesense/api/pointer"

	"github.com/andyathsid/backend/internal/domain"
)

// ChatIndexDoc is the document shape indexed into the "chats" Typesense collection.
type ChatIndexDoc struct {
	ID               string   `json:"id"`
	GroupName        string   `json:"groupName,omitempty"`
	IsGroup          bool     `json:"isGroup"`
	Participants     []string `json:"participants"`
	ParticipantNames []string `json:"participantNames"`
	UpdatedAt        int64    `json:"updatedAt"`
}

// MessageIndexDoc is the document shape indexed into the "messages" Typesense collection.
type MessageIndexDoc struct {
	ID           string   `json:"id"`
	Content      string   `json:"content"`
	SenderID     string   `json:"senderId"`
	ChatID       string   `json:"chatId"`
	Participants []string `json:"participants"`
	MediaType    string   `json:"mediaType,omitempty"`
	DocumentName string   `json:"documentName,omitempty"`
	CreatedAt    int64    `json:"createdAt"`
	DeliveredTo  []string `json:"deliveredTo,omitempty"`
	ReadBy       []string `json:"readBy,omitempty"`
}

// ContactIndexDoc is the document shape indexed into the "contacts" Typesense collection.
type ContactIndexDoc struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

// GroupIndexDoc is the document shape indexed into the "groups" Typesense collection.
type GroupIndexDoc struct {
	ID               string   `json:"id"`
	Participants     []string `json:"participants"`
	ParticipantNames []string `json:"participantNames"`
	UpdatedAt        int64    `json:"updatedAt"`
}

// SyncService provides methods to index/unindex documents in Typesense.
// Designed to be injected into ChatService and MessageService.
type SyncService struct {
	client *typesense.Client
}

// NewSyncService creates a new SyncService.
func NewSyncService(client *typesense.Client) *SyncService {
	return &SyncService{client: client}
}

var defaultIndexParams = &api.DocumentIndexParameters{}

// IndexChat upserts a chat document into the "chats" collection.
// participants should be UIDs, participantNames should be resolved usernames.
func (s *SyncService) IndexChat(ctx context.Context, doc ChatIndexDoc) error {
	_, err := s.client.Collection("chats").Documents().Upsert(ctx, doc, defaultIndexParams)
	if err != nil {
		log.Printf("[search] IndexChat error chatID=%s: %v", doc.ID, err)
	}
	return err
}

// IndexMessage upserts a message document into the "messages" collection.
func (s *SyncService) IndexMessage(ctx context.Context, doc MessageIndexDoc) error {
	_, err := s.client.Collection("messages").Documents().Upsert(ctx, doc, defaultIndexParams)
	if err != nil {
		log.Printf("[search] IndexMessage error msgID=%s: %v", doc.ID, err)
	}
	return err
}

// IndexMessageFromChat resolves chat participants before indexing the
// message so access-scoped search can filter at query time instead of after pagination.
func (s *SyncService) IndexMessageFromChat(ctx context.Context, chats domain.ChatRepository, doc MessageIndexDoc) error {
	chat, err := chats.GetChat(ctx, doc.ChatID)
	if err != nil {
		log.Printf("[search] IndexMessageFromChat chatID=%s msgID=%s: %v", doc.ChatID, doc.ID, err)
		return err
	}

	doc.Participants = chat.ParticipantIDs
	return s.IndexMessage(ctx, doc)
}

// IndexContact upserts a contact document into the "contacts" collection.
func (s *SyncService) IndexContact(ctx context.Context, doc ContactIndexDoc) error {
	_, err := s.client.Collection("contacts").Documents().Upsert(ctx, doc, defaultIndexParams)
	if err != nil {
		log.Printf("[search] IndexContact error userID=%s: %v", doc.ID, err)
	}
	return err
}

// IndexGroup upserts a group document into the "groups" collection.
func (s *SyncService) IndexGroup(ctx context.Context, doc GroupIndexDoc) error {
	_, err := s.client.Collection("groups").Documents().Upsert(ctx, doc, defaultIndexParams)
	if err != nil {
		log.Printf("[search] IndexGroup error groupID=%s: %v", doc.ID, err)
	}
	return err
}

// UnindexMessage removes a message from the "messages" collection.
func (s *SyncService) UnindexMessage(ctx context.Context, messageID string) error {
	_, err := s.client.Collection("messages").Document(messageID).Delete(ctx)
	if err != nil {
		log.Printf("[search] UnindexMessage error msgID=%s: %v", messageID, err)
	}
	return err
}

// UnindexChat removes a chat from the "chats" collection.
func (s *SyncService) UnindexChat(ctx context.Context, chatID string) error {
	_, err := s.client.Collection("chats").Document(chatID).Delete(ctx)
	if err != nil {
		log.Printf("[search] UnindexChat error chatID=%s: %v", chatID, err)
	}
	return err
}

// BulkIndexMessages imports messages in batches of 100 using upsert action.
func (s *SyncService) BulkIndexMessages(ctx context.Context, docs []MessageIndexDoc) error {
	if len(docs) == 0 {
		return nil
	}
	batch := make([]interface{}, 0, len(docs))
	for _, d := range docs {
		batch = append(batch, d)
	}
	action := api.Upsert
	params := &api.ImportDocumentsParams{Action: &action}
	results, err := s.client.Collection("messages").Documents().Import(ctx, batch, params)
	if err != nil {
		return err
	}
	for _, r := range results {
		if !r.Success {
			log.Printf("[search] BulkIndexMessages import error: %s", r.Error)
		}
	}
	return nil
}

// BulkIndexChats imports chats using upsert action.
func (s *SyncService) BulkIndexChats(ctx context.Context, docs []ChatIndexDoc) error {
	if len(docs) == 0 {
		return nil
	}
	batch := make([]interface{}, 0, len(docs))
	for _, d := range docs {
		batch = append(batch, d)
	}
	action := api.Upsert
	params := &api.ImportDocumentsParams{Action: &action}
	results, err := s.client.Collection("chats").Documents().Import(ctx, batch, params)
	if err != nil {
		return err
	}
	for _, r := range results {
		if !r.Success {
			log.Printf("[search] BulkIndexChats import error: %s", r.Error)
		}
	}
	return nil
}

// BulkIndexGroups imports groups using upsert action.
func (s *SyncService) BulkIndexGroups(ctx context.Context, docs []GroupIndexDoc) error {
	if len(docs) == 0 {
		return nil
	}
	batch := make([]interface{}, 0, len(docs))
	for _, d := range docs {
		batch = append(batch, d)
	}
	action := api.Upsert
	params := &api.ImportDocumentsParams{Action: &action}
	results, err := s.client.Collection("groups").Documents().Import(ctx, batch, params)
	if err != nil {
		return err
	}
	for _, r := range results {
		if !r.Success {
			log.Printf("[search] BulkIndexGroups import error: %s", r.Error)
		}
	}
	return nil
}

// BulkIndexContacts imports contacts using upsert action.
func (s *SyncService) BulkIndexContacts(ctx context.Context, docs []ContactIndexDoc) error {
	if len(docs) == 0 {
		return nil
	}
	batch := make([]interface{}, 0, len(docs))
	for _, d := range docs {
		batch = append(batch, d)
	}
	action := api.Upsert
	params := &api.ImportDocumentsParams{Action: &action}
	results, err := s.client.Collection("contacts").Documents().Import(ctx, batch, params)
	if err != nil {
		return err
	}
	for _, r := range results {
		if !r.Success {
			log.Printf("[search] BulkIndexContacts import error: %s", r.Error)
		}
	}
	return nil
}

// IndexChatFromRepositories resolves a chat through transport-neutral readers
// before indexing the chat and common-group documents.
func (s *SyncService) IndexChatFromRepositories(ctx context.Context, chats domain.ChatRepository, profiles domain.UserProfileRepository, chatID string) error {
	chat, err := chats.GetChat(ctx, chatID)
	if err != nil {
		return err
	}

	userProfiles, err := profiles.GetUserProfiles(ctx, chat.ParticipantIDs)
	if err != nil {
		return err
	}

	usernames := make(map[string]string, len(userProfiles))
	for userID, profile := range userProfiles {
		usernames[userID] = profile.Username
	}

	participantNames := make([]string, len(chat.ParticipantIDs))
	for index, participantID := range chat.ParticipantIDs {
		participantNames[index] = usernames[participantID]
		if participantNames[index] == "" {
			participantNames[index] = participantID
		}
	}
	groupName := chat.GroupName
	if chat.IsGroup && groupName == "" {
		groupName = "Unnamed Group"
	}
	chatDoc := ChatIndexDoc{
		ID: chat.ID, GroupName: groupName, IsGroup: chat.IsGroup,
		Participants: chat.ParticipantIDs, ParticipantNames: participantNames,
		UpdatedAt: chat.UpdatedAt.UnixMilli(),
	}
	if err := s.IndexChat(ctx, chatDoc); err != nil {
		return err
	}

	if chat.IsGroup {
		return s.IndexGroup(ctx, GroupIndexDoc{
			ID: chat.ID, Participants: chat.ParticipantIDs,
			ParticipantNames: participantNames, UpdatedAt: chatDoc.UpdatedAt,
		})
	}
	return nil
}

// ReindexUserProfile resolves the current Firestore profile before refreshing
// every query field that embeds the user's name.
func (s *SyncService) ReindexUserProfile(ctx context.Context, profiles domain.UserProfileRepository, userID string) error {
	userProfiles, err := profiles.GetUserProfiles(ctx, []string{userID})
	if err != nil {
		return err
	}
	profile, ok := userProfiles[userID]
	if !ok || profile.Username == "" {
		return nil
	}
	username := profile.Username
	log.Printf("[search] ReindexUserProfile: userID=%s username=%q", userID, username)

	_ = s.IndexContact(ctx, ContactIndexDoc{
		ID:       userID,
		Username: username,
	})

	if err := s.reindexUserInCollection(ctx, "chats", userID, username); err != nil {
		log.Printf("[search] ReindexUserProfile chats error userID=%s: %v", userID, err)
	}

	if err := s.reindexUserInCollection(ctx, "groups", userID, username); err != nil {
		log.Printf("[search] ReindexUserProfile groups error userID=%s: %v", userID, err)
	}

	return nil
}

func (s *SyncService) reindexUserInCollection(ctx context.Context, collection string, userID string, username string) error {
	page := 1
	perPage := 100

	for {
		searchParams := &api.SearchCollectionParams{
			Q:        pointer.String("*"),
			FilterBy: pointer.String("participants:=" + userID),
			Page:     pointer.Int(page),
			PerPage:  pointer.Int(perPage),
			SortBy:   pointer.String("updatedAt:desc"),
		}

		results, err := s.client.Collection(collection).Documents().Search(ctx, searchParams)
		if err != nil {
			return err
		}

		for _, hit := range *results.Hits {
			if hit.Document == nil {
				continue
			}
			doc := *hit.Document

			participants := getStringSliceFromInterface(doc["participants"])
			participantNames := getStringSliceFromInterface(doc["participantNames"])

			if len(participants) != len(participantNames) {
				log.Printf("[search] ReindexUserProfile skipping doc %v: participants/participantNames length mismatch", doc["id"])
				continue
			}

			updated := false
			for i, p := range participants {
				if p == userID {
					participantNames[i] = username
					updated = true
					break
				}
			}

			if !updated {
				continue
			}

			doc["participantNames"] = participantNames

			docID := doc["id"]
			log.Printf("[search] ReindexUserProfile updating %s doc %v", collection, docID)
			_, err := s.client.Collection(collection).Documents().Upsert(ctx, doc, defaultIndexParams)
			if err != nil {
				log.Printf("[search] ReindexUserProfile upsert error %v in %s: %v", docID, collection, err)
			}
		}

		if len(*results.Hits) < perPage {
			break
		}
		page++
	}

	log.Printf("[search] ReindexUserProfile %s: processed %d pages", collection, page)
	return nil
}

func getStringSliceFromInterface(v interface{}) []string {
	if values, ok := v.([]string); ok {
		return values
	}
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	result := make([]string, 0, len(arr))
	for _, item := range arr {
		if s, ok := item.(string); ok {
			result = append(result, s)
		}
	}
	return result
}
