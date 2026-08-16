// dev-seed-gap extends the seeded Alice and Bob chat to test pagination gaps.
//
// Scenario:
//  1. Original seed creates 150 messages. User loads all → hasMore=false cached.
//  2. This script adds 70 NEW messages (timestamps after the existing ones).
//  3. On next visit, onSnapshot returns latest 50. Gap of 20 messages exists
//     between cache and snapshot. The gap fix should force hasMore=true.
//
// Prerequisites: Run `go run ./cmd/dev-seed` first to create the base data.
//
// Usage:
//
//	go run ./cmd/dev-seed-gap              # Add 70 messages (accumulates)
//	go run ./cmd/dev-seed-gap --clean      # Remove all GAP-TEST messages first, then add 70
//
// Safe to re-run: each run adds 70 more messages with sequential numbering.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"cloud.google.com/go/firestore"
	firebaseInit "github.com/andyathsid/backend/platform/firebase"
	"github.com/google/uuid"
	_ "github.com/joho/godotenv/autoload"
)

const (
	aliceUID      = "seed_alice"
	bobUID        = "seed_bob"
	extraMsgCount = 70 // > PAGE_SIZE (50) to create a gap of 20 messages
)

var messagePool = []string{
	"Hey, are you there?",
	"Yeah, what's up?",
	"Did you see the new update?",
	"Not yet, what changed?",
	"They fixed the cache bug!",
	"Nice, about time",
	"Want to test it together?",
	"Sure, let me pull the latest",
	"I'll set up the test data",
	"How many messages do we need?",
	"At least 70 to exceed PAGE_SIZE",
	"That should trigger the gap",
	"Perfect, let's do it",
	"I'm ready when you are",
	"Starting now",
	"Keep going...",
	"Almost there",
	"This is getting long",
	"The gap should be at 20 messages",
	"Can you load more now?",
	"Yes! The button appeared!",
	"Gap detection works!",
	"Great, the fix is confirmed",
	"Let's test one more time",
	"Sure thing",
}

func main() {
	ctx := context.Background()

	// Parse flags
	cleanFirst := len(os.Args) > 1 && os.Args[1] == "--clean"

	// Init Firebase
	if err := firebaseInit.InitFirebase(); err != nil {
		log.Fatalf("firebase init failed: %v", err)
	}

	// Init Firestore
	fsClient, err := firebaseInit.App.Firestore(ctx)
	if err != nil {
		log.Fatalf("firestore init failed: %v", err)
	}
	defer fsClient.Close()

	// Find existing Alice ↔ Bob chat in Firestore
	chatID := ""
	docs, _ := fsClient.Collection("chats").
		Where("participants", "array-contains", aliceUID).
		Where("isGroup", "==", false).
		Documents(ctx).GetAll()
	for _, doc := range docs {
		data := doc.Data()
		participants, _ := data["participants"].([]interface{})
		for _, p := range participants {
			if p.(string) == bobUID {
				chatID = doc.Ref.ID
				break
			}
		}
		if chatID != "" {
			break
		}
	}
	if chatID == "" {
		log.Fatal("Alice ↔ Bob chat not found. Run `go run ./cmd/dev-seed` first.")
	}
	log.Printf("Found Alice ↔ Bob chat: %s", chatID)

	// Step 1: Optionally clean previous gap-test messages
	if cleanFirst {
		log.Println("=== Step 1: Cleaning all GAP-TEST messages (--clean flag) ===")
		cleaned := cleanupGapTestMessages(ctx, fsClient, chatID)
		log.Printf("Removed %d GAP-TEST messages", cleaned)
	} else {
		log.Println("=== Step 1: Skipping cleanup (use --clean to reset) ===")
	}

	// Step 2: Count existing GAP-TEST messages for sequential numbering
	log.Println("=== Step 2: Counting existing GAP-TEST messages ===")
	existingCount := countGapTestMessages(ctx, fsClient, chatID)
	log.Printf("Found %d existing GAP-TEST messages", existingCount)

	// Step 3: Find the latest message timestamp to continue from
	log.Println("=== Step 3: Finding latest message timestamp ===")
	latestTime := findLatestMessageTime(ctx, fsClient, chatID)
	if latestTime.IsZero() {
		log.Fatal("No existing messages found in chat")
	}
	log.Printf("Latest message at: %v", latestTime)

	// Step 4: Generate 70 new messages AFTER the existing ones
	log.Printf("=== Step 4: Adding %d new messages (numbered %d-%d) ===", extraMsgCount, existingCount+1, existingCount+extraMsgCount)
	msgs := generateGapTestMessages(extraMsgCount, latestTime.Add(2*time.Minute), existingCount)
	insertMessages(ctx, fsClient, chatID, msgs)

	// Update lastMessage on chat doc
	lastMsg := msgs[len(msgs)-1]
	lastMsgTime := lastMsg["createdAt"].(time.Time)
	_, _ = fsClient.Collection("chats").Doc(chatID).Update(ctx, []firestore.Update{
		{Path: "lastMessage", Value: map[string]any{
			"senderId":   lastMsg["senderID"].(string),
			"senderName": lastMsg["senderName"].(string),
			"content":    lastMsg["text"].(string),
			"createdAt":  lastMsgTime,
		}},
		{Path: "updatedAt", Value: lastMsgTime},
	})

	totalGap := existingCount + extraMsgCount
	log.Println("=== Gap test seed complete! ===")
	log.Printf("Added %d GAP-TEST messages (total GAP-TEST: %d)", extraMsgCount, totalGap)
	log.Println()
	log.Println("To test the gap detection fix:")
	log.Println("  1. Open the app, navigate to Alice ↔ Bob chat")
	log.Println("  2. Scroll up and load ALL messages (hasMore should become false)")
	log.Println("  3. Navigate away to another chat (cache saves)")
	log.Println("  4. Run: go run ./cmd/dev-seed-gap")
	log.Println("  5. Navigate back to Alice ↔ Bob chat")
	log.Println("  6. Check console for: '[Optimization] Gap fix for chat ...'")
	log.Println("  7. 'Load older messages' button should appear (hasMore=true)")
	log.Println()
	log.Printf("Tip: Run again to add another 70 messages (total would be %d)", totalGap+extraMsgCount)
	log.Println("     Use --clean flag to reset all GAP-TEST messages first")
}

// cleanupGapTestMessages removes all GAP-TEST messages from Firestore.
func cleanupGapTestMessages(ctx context.Context, fs *firestore.Client, chatID string) int {
	msgDocs, _ := fs.Collection("chats").Doc(chatID).Collection("messages").
		Where("content", ">=", "[GAP-TEST").
		Where("content", "<", "[GAP-TEST~").
		Documents(ctx).GetAll()

	batch := fs.Batch()
	count := 0
	for _, doc := range msgDocs {
		batch.Delete(doc.Ref)
		count++
	}
	if count > 0 {
		_, _ = batch.Commit(ctx)
	}
	return count
}

// countGapTestMessages counts existing GAP-TEST messages for sequential numbering.
func countGapTestMessages(ctx context.Context, fs *firestore.Client, chatID string) int {
	msgDocs, _ := fs.Collection("chats").Doc(chatID).Collection("messages").
		Where("content", ">=", "[GAP-TEST").
		Where("content", "<", "[GAP-TEST~").
		Documents(ctx).GetAll()
	return len(msgDocs)
}

// findLatestMessageTime returns the createdAt of the newest message in the chat.
func findLatestMessageTime(ctx context.Context, fs *firestore.Client, chatID string) time.Time {
	q := fs.Collection("chats").Doc(chatID).Collection("messages").
		OrderBy("createdAt", firestore.Desc).
		Limit(1)
	docs, err := q.Documents(ctx).GetAll()
	if err != nil || len(docs) == 0 {
		return time.Time{}
	}
	data := docs[0].Data()
	ts, ok := data["createdAt"]
	if !ok {
		return time.Time{}
	}
	switch v := ts.(type) {
	case time.Time:
		return v
	default:
		return time.Time{}
	}
}

// generateGapTestMessages creates n messages starting from startTime.
// startNum is the offset for sequential numbering (e.g., if 70 exist, start from 71).
func generateGapTestMessages(n int, startTime time.Time, startNum int) []map[string]any {
	msgs := make([]map[string]any, n)
	senders := []struct {
		ID   string
		Name string
	}{
		{aliceUID, "Alice"},
		{bobUID, "Bob"},
	}

	for i := range n {
		sender := senders[i%2]
		num := startNum + i + 1
		msgs[i] = map[string]any{
			"senderID":   sender.ID,
			"senderName": sender.Name,
			"text":       fmt.Sprintf("[GAP-TEST %d/%d] %s", num, startNum+n, messagePool[i%len(messagePool)]),
			"createdAt":  startTime.Add(time.Duration(i) * 2 * time.Minute),
		}
	}
	return msgs
}

// insertMessages writes messages to Firestore.
func insertMessages(ctx context.Context, fs *firestore.Client, chatID string, msgs []map[string]any) {
	for i, m := range msgs {
		msgID := uuid.New().String()
		senderID := m["senderID"].(string)
		senderName := m["senderName"].(string)
		text := m["text"].(string)
		createdAt := m["createdAt"].(time.Time)

		fsMsg := map[string]any{
			"senderId":   senderID,
			"senderName": senderName,
			"content":    text,
			"createdAt":  createdAt,
		}
		_, _ = fs.Collection("chats").Doc(chatID).Collection("messages").Doc(msgID).Set(ctx, fsMsg)

		if (i+1)%20 == 0 {
			log.Printf("  Inserted %d/%d messages", i+1, len(msgs))
		}
	}
}
