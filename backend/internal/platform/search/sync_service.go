package search

import (
	"context"
	"fmt"
	"log"

	"github.com/meilisearch/meilisearch-go"

	"github.com/andyathsid/backend/internal/domain"
)

// ChatIndexDoc is the document shape indexed into the "chats" Meilisearch index.
type ChatIndexDoc struct {
	ID               string   `json:"id"`
	GroupName        string   `json:"groupName,omitempty"`
	IsGroup          bool     `json:"isGroup"`
	Participants     []string `json:"participants"`
	ParticipantNames []string `json:"participantNames"`
	UpdatedAt        int64    `json:"updatedAt"`
}

// MessageIndexDoc is the document shape indexed into the "messages" Meilisearch index.
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

// ContactIndexDoc is the document shape indexed into the "contacts" Meilisearch index.
type ContactIndexDoc struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

// GroupIndexDoc is the document shape indexed into the "groups" Meilisearch index.
type GroupIndexDoc struct {
	ID               string   `json:"id"`
	Participants     []string `json:"participants"`
	ParticipantNames []string `json:"participantNames"`
	UpdatedAt        int64    `json:"updatedAt"`
}

// SyncService provides task-aware index and unindex operations for Meilisearch.
type SyncService struct {
	client meilisearch.ServiceManager
}

func NewSyncService(client meilisearch.ServiceManager) *SyncService {
	return &SyncService{client: client}
}

func (s *SyncService) upsert(ctx context.Context, indexName string, docs interface{}) error {
	task, err := s.client.Index(indexName).AddDocumentsWithContext(ctx, docs, nil)
	if err != nil {
		return err
	}
	return waitForTask(s.client, task)
}

func (s *SyncService) IndexChat(ctx context.Context, doc ChatIndexDoc) error {
	if err := s.upsert(ctx, "chats", []ChatIndexDoc{doc}); err != nil {
		log.Printf("[search] IndexChat error chatID=%s: %v", doc.ID, err)
		return err
	}
	return nil
}

func (s *SyncService) IndexMessage(ctx context.Context, doc MessageIndexDoc) error {
	if err := s.upsert(ctx, "messages", []MessageIndexDoc{doc}); err != nil {
		log.Printf("[search] IndexMessage error msgID=%s: %v", doc.ID, err)
		return err
	}
	return nil
}

// IndexMessageFromChat resolves participants so scoped message searches can
// filter before pagination.
func (s *SyncService) IndexMessageFromChat(ctx context.Context, chats domain.ChatRepository, doc MessageIndexDoc) error {
	chat, err := chats.GetChat(ctx, doc.ChatID)
	if err != nil {
		log.Printf("[search] IndexMessageFromChat chatID=%s msgID=%s: %v", doc.ChatID, doc.ID, err)
		return err
	}
	doc.Participants = chat.ParticipantIDs
	return s.IndexMessage(ctx, doc)
}

func (s *SyncService) IndexContact(ctx context.Context, doc ContactIndexDoc) error {
	if err := s.upsert(ctx, "contacts", []ContactIndexDoc{doc}); err != nil {
		log.Printf("[search] IndexContact error userID=%s: %v", doc.ID, err)
		return err
	}
	return nil
}

func (s *SyncService) IndexGroup(ctx context.Context, doc GroupIndexDoc) error {
	if err := s.upsert(ctx, "groups", []GroupIndexDoc{doc}); err != nil {
		log.Printf("[search] IndexGroup error groupID=%s: %v", doc.ID, err)
		return err
	}
	return nil
}

func (s *SyncService) UnindexMessage(ctx context.Context, messageID string) error {
	task, err := s.client.Index("messages").DeleteDocumentWithContext(ctx, messageID, nil)
	if err != nil {
		log.Printf("[search] UnindexMessage error msgID=%s: %v", messageID, err)
		return err
	}
	if err := waitForTask(s.client, task); err != nil {
		log.Printf("[search] UnindexMessage task error msgID=%s: %v", messageID, err)
		return err
	}
	return nil
}

func (s *SyncService) UnindexChat(ctx context.Context, chatID string) error {
	task, err := s.client.Index("chats").DeleteDocumentWithContext(ctx, chatID, nil)
	if err != nil {
		return err
	}
	return waitForTask(s.client, task)
}

func (s *SyncService) BulkIndexMessages(ctx context.Context, docs []MessageIndexDoc) error {
	if len(docs) == 0 {
		return nil
	}
	return s.upsert(ctx, "messages", docs)
}

func (s *SyncService) BulkIndexChats(ctx context.Context, docs []ChatIndexDoc) error {
	if len(docs) == 0 {
		return nil
	}
	return s.upsert(ctx, "chats", docs)
}

func (s *SyncService) BulkIndexGroups(ctx context.Context, docs []GroupIndexDoc) error {
	if len(docs) == 0 {
		return nil
	}
	return s.upsert(ctx, "groups", docs)
}

func (s *SyncService) BulkIndexContacts(ctx context.Context, docs []ContactIndexDoc) error {
	if len(docs) == 0 {
		return nil
	}
	return s.upsert(ctx, "contacts", docs)
}

// IndexChatFromRepositories resolves the chat and profiles before indexing the
// chat and, when relevant, its common-group document.
func (s *SyncService) IndexChatFromRepositories(ctx context.Context, chats domain.ChatRepository, profiles domain.UserProfileRepository, chatID string) error {
	chat, err := chats.GetChat(ctx, chatID)
	if err != nil {
		return err
	}
	userProfiles, err := profiles.GetUserProfiles(ctx, chat.ParticipantIDs)
	if err != nil {
		return err
	}
	participantNames := make([]string, len(chat.ParticipantIDs))
	for i, participantID := range chat.ParticipantIDs {
		participantNames[i] = userProfiles[participantID].Username
		if participantNames[i] == "" {
			participantNames[i] = participantID
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

// ReindexUserProfile refreshes the contact plus the participant name embedded
// in every chat and group containing the user.
func (s *SyncService) ReindexUserProfile(ctx context.Context, profiles domain.UserProfileRepository, userID string) error {
	userProfiles, err := profiles.GetUserProfiles(ctx, []string{userID})
	if err != nil {
		return err
	}
	profile, ok := userProfiles[userID]
	if !ok || profile.Username == "" {
		return nil
	}
	if err := s.IndexContact(ctx, ContactIndexDoc{ID: userID, Username: profile.Username}); err != nil {
		return err
	}
	for _, indexName := range []string{"chats", "groups"} {
		if err := s.reindexUserInIndex(ctx, indexName, userID, profile.Username); err != nil {
			return err
		}
	}
	return nil
}

func (s *SyncService) reindexUserInIndex(ctx context.Context, indexName, userID, username string) error {
	const pageSize int64 = 100
	for offset := int64(0); ; offset += pageSize {
		result := meilisearch.DocumentsResult{}
		err := s.client.Index(indexName).GetDocumentsWithContext(ctx, &meilisearch.DocumentsQuery{
			Offset: offset,
			Limit:  pageSize,
			Filter: fmt.Sprintf("participants = %q", userID),
		}, &result)
		if err != nil {
			return err
		}

		updates := make([]map[string]interface{}, 0, len(result.Results))
		for _, doc := range result.Results {
			participants := stringSlice(doc["participants"])
			names := stringSlice(doc["participantNames"])
			if len(participants) != len(names) {
				log.Printf("[search] ReindexUserProfile skipping %s doc %v: participants/participantNames mismatch", indexName, doc["id"])
				continue
			}
			for i, participantID := range participants {
				if participantID == userID {
					names[i] = username
					updates = append(updates, map[string]interface{}{"id": doc["id"], "participantNames": names})
					break
				}
			}
		}
		if len(updates) > 0 {
			task, err := s.client.Index(indexName).UpdateDocumentsWithContext(ctx, updates, nil)
			if err != nil {
				return err
			}
			if err := waitForTask(s.client, task); err != nil {
				return err
			}
		}
		if offset+int64(len(result.Results)) >= result.Total {
			return nil
		}
	}
}

func stringSlice(value interface{}) []string {
	if values, ok := value.([]string); ok {
		return values
	}
	items, ok := value.([]interface{})
	if !ok {
		return nil
	}
	values := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok {
			values = append(values, text)
		}
	}
	return values
}
