package search

import (
	"context"
	"log"

	"github.com/typesense/typesense-go/v3/typesense"
	"github.com/typesense/typesense-go/v3/typesense/api"
)

func ptr[T any](v T) *T { return &v }

func collectionSchemas() []api.CollectionSchema {
	return []api.CollectionSchema{
		{
			Name: "messages",
			Fields: []api.Field{
				{Name: "content", Type: "string"},
				{Name: "documentName", Type: "string", Optional: ptr(true)},
				{Name: "chatId", Type: "string"},
				{Name: "participants", Type: "string[]"},
				{Name: "createdAt", Type: "int64"},
				{Name: "senderId", Type: "string", Optional: ptr(true), Index: ptr(false)},
				{Name: "mediaType", Type: "string", Optional: ptr(true), Index: ptr(false)},
				{Name: "deliveredTo", Type: "string[]", Optional: ptr(true), Index: ptr(false)},
				{Name: "readBy", Type: "string[]", Optional: ptr(true), Index: ptr(false)},
			},
			DefaultSortingField: ptr("createdAt"),
		},
		{
			Name: "chats",
			Fields: []api.Field{
				{Name: "groupName", Type: "string", Optional: ptr(true)},
				{Name: "participantNames", Type: "string[]"},
				{Name: "participants", Type: "string[]"},
				{Name: "updatedAt", Type: "int64"},
				{Name: "isGroup", Type: "bool", Optional: ptr(true), Index: ptr(false)},
			},
			DefaultSortingField: ptr("updatedAt"),
		},
		{
			Name: "contacts",
			Fields: []api.Field{
				{Name: "username", Type: "string"},
			},
		},
		{
			Name: "groups",
			Fields: []api.Field{
				{Name: "participantNames", Type: "string[]"},
				{Name: "participants", Type: "string[]"},
				{Name: "updatedAt", Type: "int64"},
			},
			DefaultSortingField: ptr("updatedAt"),
		},
	}
}

// EnsureCollections creates Typesense collections if they don't already exist.
// Safe to call on every startup.
func EnsureCollections(ctx context.Context, client *typesense.Client) error {
	for _, schema := range collectionSchemas() {
		// Try to retrieve; if collection exists, skip.
		if _, err := client.Collection(schema.Name).Retrieve(ctx); err == nil {
			log.Printf("Typesense collection %q already exists", schema.Name)
			continue
		}

		if _, err := client.Collections().Create(ctx, &schema); err != nil {
			return err
		}
		log.Printf("Typesense collection %q created", schema.Name)
	}

	return nil
}
