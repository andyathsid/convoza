package search

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"
)

func TestBuildChatIndexDocuments(t *testing.T) {
	updatedAt := time.Date(2026, time.June, 29, 12, 0, 0, 123000000, time.UTC)
	data := map[string]interface{}{
		"isGroup":      false,
		"participants": []interface{}{"user-1", "user-2"},
		"updatedAt":    updatedAt,
	}

	chat, group := buildChatIndexDocuments("chat-1", data, map[string]string{"user-2": "Budi"})
	if group != nil {
		t.Fatal("DM must not produce a group document")
	}
	if !reflect.DeepEqual(chat.ParticipantNames, []string{"user-1", "Budi"}) {
		t.Fatalf("participant names = %#v", chat.ParticipantNames)
	}
	if chat.UpdatedAt != updatedAt.UnixMilli() {
		t.Fatalf("updatedAt = %d, want %d", chat.UpdatedAt, updatedAt.UnixMilli())
	}

	data["isGroup"] = true
	data["groupName"] = "Project Room"
	chat, group = buildChatIndexDocuments("chat-1", data, map[string]string{"user-1": "Ayu", "user-2": "Budi"})
	if group == nil {
		t.Fatal("group chat must produce a group document")
	}
	if chat.GroupName != "Project Room" || group.ID != chat.ID {
		t.Fatalf("unexpected chat/group documents: %#v %#v", chat, group)
	}
}

func TestBuildMessageIndexDocument(t *testing.T) {
	createdAt := time.Date(2026, time.June, 29, 12, 30, 0, 0, time.UTC)
	data := map[string]interface{}{
		"type":         "media",
		"content":      "",
		"senderId":     "user-1",
		"mediaType":    "document",
		"documentName": "report.pdf",
		"createdAt":    createdAt,
		"deliveredTo":  map[string]interface{}{"user-3": createdAt, "user-2": createdAt},
		"readBy":       map[string]interface{}{"user-2": createdAt},
	}

	doc, ok := buildMessageIndexDocument("message-1", "chat-1", []string{"user-1", "user-2", "user-3"}, data)
	if !ok {
		t.Fatal("non-system message was skipped")
	}
	if doc.CreatedAt != createdAt.UnixMilli() {
		t.Fatalf("createdAt = %d, want %d", doc.CreatedAt, createdAt.UnixMilli())
	}
	if !reflect.DeepEqual(doc.DeliveredTo, []string{"user-2", "user-3"}) {
		t.Fatalf("deliveredTo = %#v", doc.DeliveredTo)
	}
	if doc.DocumentName != "report.pdf" || doc.MediaType != "document" {
		t.Fatalf("media fields were not retained: %#v", doc)
	}
	if !reflect.DeepEqual(doc.Participants, []string{"user-1", "user-2", "user-3"}) {
		t.Fatalf("participants = %#v", doc.Participants)
	}

	data["type"] = "system"
	if _, ok := buildMessageIndexDocument("system-1", "chat-1", []string{"user-1"}, data); ok {
		t.Fatal("system message must be skipped")
	}
}

func TestDocumentJSONOmitsRemovedFields(t *testing.T) {
	encoded, err := json.Marshal(MessageIndexDoc{ID: "message-1", SenderID: "user-1"})
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]interface{}
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	for _, removed := range []string{"senderName", "type"} {
		if _, ok := fields[removed]; ok {
			t.Fatalf("removed field %q is still serialized", removed)
		}
	}
	if fields["senderId"] != "user-1" {
		t.Fatal("senderId reference must remain in the document")
	}
}
