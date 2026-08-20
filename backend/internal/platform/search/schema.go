package search

import (
	"fmt"
	"time"

	"github.com/meilisearch/meilisearch-go"
)

const taskPollInterval = 100 * time.Millisecond

type indexDefinition struct {
	uid      string
	settings *meilisearch.Settings
}

func indexDefinitions() []indexDefinition {
	return []indexDefinition{
		{
			uid: "messages",
			settings: &meilisearch.Settings{
				SearchableAttributes: []string{"content", "documentName"},
				FilterableAttributes: []string{"chatId", "participants", "createdAt"},
				SortableAttributes:   []string{"createdAt"},
				DisplayedAttributes:  []string{"id", "content", "documentName", "chatId", "participants", "createdAt", "senderId", "mediaType", "deliveredTo", "readBy"},
			},
		},
		{
			uid: "chats",
			settings: &meilisearch.Settings{
				SearchableAttributes: []string{"groupName", "participantNames"},
				FilterableAttributes: []string{"participants"},
				SortableAttributes:   []string{"updatedAt"},
				DisplayedAttributes:  []string{"id", "groupName", "participantNames", "participants", "updatedAt", "isGroup"},
			},
		},
		{
			uid: "contacts",
			settings: &meilisearch.Settings{
				SearchableAttributes: []string{"username"},
				DisplayedAttributes:  []string{"id", "username"},
			},
		},
		{
			uid: "groups",
			settings: &meilisearch.Settings{
				SearchableAttributes: []string{"participantNames"},
				FilterableAttributes: []string{"participants"},
				SortableAttributes:   []string{"updatedAt"},
				DisplayedAttributes:  []string{"id", "participantNames", "participants", "updatedAt"},
			},
		},
	}
}

func waitForTask(client meilisearch.ServiceManager, task *meilisearch.TaskInfo) error {
	completed, err := client.WaitForTask(task.TaskUID, taskPollInterval)
	if err != nil {
		return err
	}
	if completed.Status == meilisearch.TaskStatus("failed") {
		return fmt.Errorf("meilisearch task %d failed: %v", task.TaskUID, completed.Error)
	}
	return nil
}

// EnsureIndexes creates the application's indexes when missing and applies their
// current settings on every startup. It never deletes documents.
func EnsureIndexes(client meilisearch.ServiceManager) error {
	for _, definition := range indexDefinitions() {
		if _, err := client.GetIndex(definition.uid); err != nil {
			task, createErr := client.CreateIndex(&meilisearch.IndexConfig{Uid: definition.uid, PrimaryKey: "id"})
			if createErr != nil {
				return fmt.Errorf("create index %q: %w", definition.uid, createErr)
			}
			if err := waitForTask(client, task); err != nil {
				return fmt.Errorf("wait for index %q creation: %w", definition.uid, err)
			}
		}

		task, err := client.Index(definition.uid).UpdateSettings(definition.settings)
		if err != nil {
			return fmt.Errorf("update settings for index %q: %w", definition.uid, err)
		}
		if err := waitForTask(client, task); err != nil {
			return fmt.Errorf("wait for settings of index %q: %w", definition.uid, err)
		}
	}
	return nil
}
