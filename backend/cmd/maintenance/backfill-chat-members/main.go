// backfill-chat-members repairs member and unread records for existing chats.
// Run: go run ./cmd/maintenance/backfill-chat-members

package main

import (
	"context"
	"log"

	"cloud.google.com/go/firestore"
	firebaseInit "github.com/andyathsid/backend/platform/firebase"
	_ "github.com/joho/godotenv/autoload"
	"google.golang.org/api/iterator"
)

type unreadState struct {
	count    int
	latestID string
	latestAt interface{}
}

func main() {
	ctx := context.Background()
	if err := firebaseInit.InitFirebase(); err != nil {
		log.Fatal(err)
	}
	client, err := firebaseInit.App.Firestore(ctx)
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	chatIter := client.Collection("chats").Documents(ctx)
	defer chatIter.Stop()
	updated := 0
	for {
		chatDoc, err := chatIter.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			log.Fatal(err)
		}
		data := chatDoc.Data()
		participants, _ := data["participants"].([]interface{})
		creatorID, _ := data["createdBy"].(string)
		participantIDs := make([]string, 0, len(participants))
		states := make(map[string]*unreadState, len(participants))
		for _, rawID := range participants {
			if userID, ok := rawID.(string); ok && userID != "" {
				participantIDs = append(participantIDs, userID)
				states[userID] = &unreadState{}
			}
		}

		messageIter := chatDoc.Ref.Collection("messages").OrderBy("createdAt", firestore.Desc).Documents(ctx)
		for {
			messageDoc, messageErr := messageIter.Next()
			if messageErr == iterator.Done {
				break
			}
			if messageErr != nil {
				log.Fatal(messageErr)
			}
			message := messageDoc.Data()
			if messageType, _ := message["type"].(string); messageType == "system" {
				continue
			}
			senderID, _ := message["senderId"].(string)
			readBy, _ := message["readBy"].(map[string]interface{})
			for _, userID := range participantIDs {
				if userID == senderID {
					continue
				}
				if _, isRead := readBy[userID]; isRead {
					continue
				}
				state := states[userID]
				state.count++
				if state.latestID == "" {
					state.latestID = messageDoc.Ref.ID
					state.latestAt = message["createdAt"]
				}
			}
		}
		messageIter.Stop()

		for _, userID := range participantIDs {
			memberRef := chatDoc.Ref.Collection("members").Doc(userID)
			memberDoc, getErr := memberRef.Get(ctx)
			memberData := map[string]interface{}{}
			if getErr == nil {
				memberData = memberDoc.Data()
			}
			state := states[userID]
			defaults := map[string]interface{}{
				"chatId": chatDoc.Ref.ID, "uid": userID, "leftAt": nil, "removedBy": nil,
				"hasUnread": state.count > 0, "unreadCount": state.count,
				"lastUnreadAt": state.latestAt, "latestUnreadMessageId": nullableString(state.latestID),
			}
			if _, exists := memberData["role"]; !exists {
				defaults["role"] = "member"
				if userID == creatorID {
					defaults["role"] = "creator"
				}
				defaults["joinedAt"] = data["createdAt"]
			}
			for key := range defaults {
				if _, exists := memberData[key]; exists {
					delete(defaults, key)
				}
			}
			if len(defaults) == 0 {
				continue
			}
			if _, err := memberRef.Set(ctx, defaults, firestore.MergeAll); err != nil {
				log.Fatal(err)
			}
			updated++
		}
	}
	log.Printf("backfilled %d chat member documents", updated)
}

func nullableString(value string) interface{} {
	if value == "" {
		return nil
	}
	return value
}
