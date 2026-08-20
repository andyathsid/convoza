package search

import "testing"

func TestIndexDefinitionsMatchApplicationSearchContract(t *testing.T) {
	definitions := indexDefinitions()
	byUID := make(map[string]bool, len(definitions))
	for _, definition := range definitions {
		byUID[definition.uid] = true
		if definition.settings == nil {
			t.Fatalf("index %q has no settings", definition.uid)
		}
	}
	for _, uid := range []string{"messages", "chats", "contacts", "groups"} {
		if !byUID[uid] {
			t.Fatalf("missing %q index definition", uid)
		}
	}

	messages := definitions[0].settings
	if !contains(messages.SearchableAttributes, "content") || !contains(messages.SearchableAttributes, "documentName") {
		t.Fatalf("messages searchable attributes = %#v", messages.SearchableAttributes)
	}
	if !contains(messages.FilterableAttributes, "participants") || !contains(messages.SortableAttributes, "createdAt") {
		t.Fatalf("messages search controls = %#v / %#v", messages.FilterableAttributes, messages.SortableAttributes)
	}
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
