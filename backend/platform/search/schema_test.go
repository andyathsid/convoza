package search

import "testing"

func TestCollectionSchemasIndexOnlyQueryFields(t *testing.T) {
	tests := []struct {
		collection string
		indexed    []string
		unindexed  []string
		removed    []string
		sortField  string
	}{
		{
			collection: "messages",
			indexed:    []string{"content", "documentName", "chatId", "participants", "createdAt"},
			unindexed:  []string{"senderId", "mediaType", "deliveredTo", "readBy"},
			removed:    []string{"senderName", "type"},
			sortField:  "createdAt",
		},
		{
			collection: "chats",
			indexed:    []string{"groupName", "participantNames", "participants", "updatedAt"},
			unindexed:  []string{"isGroup"},
			removed:    []string{"name"},
			sortField:  "updatedAt",
		},
		{
			collection: "contacts",
			indexed:    []string{"username"},
			removed:    []string{"avatar"},
		},
		{
			collection: "groups",
			indexed:    []string{"participantNames", "participants", "updatedAt"},
			removed:    []string{"groupName"},
			sortField:  "updatedAt",
		},
	}

	schemas := collectionSchemas()
	for _, test := range tests {
		t.Run(test.collection, func(t *testing.T) {
			var fields = map[string]struct {
				indexed  bool
				optional bool
			}{}
			var sortField string
			for _, schema := range schemas {
				if schema.Name != test.collection {
					continue
				}
				if schema.DefaultSortingField != nil {
					sortField = *schema.DefaultSortingField
				}
				for _, field := range schema.Fields {
					fields[field.Name] = struct {
						indexed  bool
						optional bool
					}{
						indexed:  field.Index == nil || *field.Index,
						optional: field.Optional != nil && *field.Optional,
					}
				}
			}

			for _, name := range test.indexed {
				field, ok := fields[name]
				if !ok || !field.indexed {
					t.Fatalf("field %q must be indexed", name)
				}
			}
			for _, name := range test.unindexed {
				field, ok := fields[name]
				if !ok || field.indexed || !field.optional {
					t.Fatalf("field %q must be optional and unindexed", name)
				}
			}
			for _, name := range test.removed {
				if _, ok := fields[name]; ok {
					t.Fatalf("removed field %q is still declared", name)
				}
			}
			if sortField != test.sortField {
				t.Fatalf("default sort field = %q, want %q", sortField, test.sortField)
			}
		})
	}
}
