// dev-seed creates dummy accounts and fake data for local Firestore testing.
// Creates:
//   - 2 loginable accounts: alice@test.com, bob@test.com
//   - 50 fake users
//   - Alice ↔ Bob chat with 150 messages (test pagination / Fase 2: multiple loadMore calls)
//   - Alice ↔ 50 fake users chats with 5-30 messages each (test chat list / Fase 1)
//
// Run: go run ./cmd/dev-seed
// Safe to re-run (idempotent).

package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"time"

	"cloud.google.com/go/firestore"
	firebaseAuth "firebase.google.com/go/v4/auth"
	"github.com/andyathsid/backend/app/models"
	apprepo "github.com/andyathsid/backend/app/repository"
	"github.com/andyathsid/backend/platform/database"
	"github.com/andyathsid/backend/platform/database/repositories"
	firebaseInit "github.com/andyathsid/backend/platform/firebase"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
	_ "github.com/joho/godotenv/autoload"
)

// Seed user definitions
type seedUser struct {
	UID      string
	Email    string
	Username string
}

var dummyAccounts = []seedUser{
	{UID: "seed_alice", Email: "alice@test.com", Username: "Alice"},
	{UID: "seed_bob", Email: "bob@test.com", Username: "Bob"},
}

var fakeUsers []seedUser

func init() {
	names := []string{
		"Charlie", "Diana", "Eve", "Frank", "Grace",
		"Henry", "Iris", "Jack", "Kate", "Leo",
		"Mia", "Noah", "Olivia", "Paul", "Quinn",
		"Rosa", "Sam", "Tina", "Uma", "Victor",
		"Wendy", "Xander", "Yara", "Zane", "Aria",
		"Blake", "Clara", "Derek", "Elena", "Felix",
		"Gina", "Hugo", "Ivy", "Jake", "Kira",
		"Liam", "Maya", "Nate", "Olive", "Piper",
		"Reed", "Sara", "Troy", "Ursula", "Vince",
		"Wren", "Xiomara", "Yusuf", "Zoe", "Aiden",
	}
	for i, name := range names {
		fakeUsers = append(fakeUsers, seedUser{
			UID:      fmt.Sprintf("seed_user_%02d", i+1),
			Email:    fmt.Sprintf("%s@test.com", name),
			Username: name,
		})
	}
}

// Reusable message pool for generating conversations
var messagePool = []string{
	"Hey!",
	"How are you?",
	"I'm good, you?",
	"What are you up to?",
	"Not much, just working",
	"Same here",
	"Want to grab lunch?",
	"Sure, where?",
	"That new place downtown?",
	"Sounds good!",
	"On my way",
	"See you soon",
	"Thanks!",
	"No problem",
	"That's great",
	"I know right?",
	"Haha",
	"Lol",
	"Nice one",
	"Agreed",
	"Let me check",
	"I'll get back to you",
	"Sounds like a plan",
	"Perfect",
	"Got it",
	"Will do",
	"See you later",
	"Bye!",
	"Good morning!",
	"Good night!",
	"Have a great day!",
	"You too!",
	"What do you think?",
	"I think so too",
	"Can you help me?",
	"Of course!",
	"I appreciate it",
	"Anytime",
	"That makes sense",
	"I'll look into it",
}

// generateMessages creates n messages alternating between two senders
func generateMessages(n int, sender1ID, sender1Name, sender2ID, sender2Name string) []map[string]interface{} {
	msgs := make([]map[string]interface{}, n)
	baseTime := time.Now().Add(-48 * time.Hour)

	for i := 0; i < n; i++ {
		var senderID, senderName string
		if i%2 == 0 {
			senderID, senderName = sender1ID, sender1Name
		} else {
			senderID, senderName = sender2ID, sender2Name
		}

		msgs[i] = map[string]interface{}{
			"senderID":   senderID,
			"senderName": senderName,
			"text":       messagePool[i%len(messagePool)],
			"createdAt":  baseTime.Add(time.Duration(i) * 2 * time.Minute),
		}
	}
	return msgs
}

func main() {
	ctx := context.Background()

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

	// Init Auth client
	authClient, err := firebaseInit.App.Auth(ctx)
	if err != nil {
		log.Fatalf("auth client init failed: %v", err)
	}

	// Init PostgreSQL (users only)
	db, err := database.OpenDBConnection()
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	userRepo := repositories.NewUserRepositorySQL(db)

	allUsers := append(dummyAccounts, fakeUsers...)
	rng := rand.New(rand.NewSource(42))

	// Step 0: Clean up old seed data (idempotent)
	log.Println("=== Step 0: Cleaning up old seed data ===")
	cleanupSeedData(ctx, authClient, fsClient, db, allUsers, firebaseInit.RTDBMembershipMirror)

	// Step 1: Create users in Firebase Auth + PostgreSQL + Firestore
	log.Println("=== Step 1: Creating users ===")
	for _, u := range allUsers {
		ensureFirebaseUser(ctx, authClient, u)
		ensurePGUser(ctx, userRepo, u)
		ensureFirestoreUser(ctx, fsClient, u)
	}
	log.Printf("Created %d users total", len(allUsers))

	// Step 2: Create Alice ↔ Bob chat with 150 messages
	log.Println("=== Step 2: Creating Alice ↔ Bob chat (150 messages) ===")
	alice := dummyAccounts[0]
	bob := dummyAccounts[1]
	chatID := ensureChat(ctx, fsClient, firebaseInit.RTDBMembershipMirror, alice.UID, alice.Username, bob.UID, bob.Username, false, "")
	bobMsgs := generateMessages(150, alice.UID, "Alice", bob.UID, "Bob")
	ensureMessages(ctx, fsClient, chatID, bobMsgs)
	log.Printf("Alice ↔ Bob chat: 150 messages")

	// Step 3: Create Alice ↔ fake user chats with 5-30 messages each
	log.Println("=== Step 3: Creating Alice ↔ fake user chats ===")
	for _, fu := range fakeUsers {
		msgCount := 5 + rng.Intn(26) // 5 to 30
		fuChatID := ensureChat(ctx, fsClient, firebaseInit.RTDBMembershipMirror, alice.UID, alice.Username, fu.UID, fu.Username, false, "")
		fuMsgs := generateMessages(msgCount, alice.UID, "Alice", fu.UID, fu.Username)
		ensureMessages(ctx, fsClient, fuChatID, fuMsgs)
	}

	log.Println("=== Seed complete! ===")
	log.Printf("Created %d users + %d chats with messages", len(allUsers), len(fakeUsers)+1)
	log.Println("Login with: alice@test.com / password123")
	log.Println("Login with: bob@test.com / password123")
}

// cleanupSeedData removes all old seed data to ensure idempotency.
func cleanupSeedData(ctx context.Context, auth *firebaseAuth.Client, fs *firestore.Client, db *sqlx.DB, users []seedUser, mirror firebaseInit.MembershipMirror) {
	// 1. Delete Firestore chats where any seed user is a participant
	for _, u := range users {
		docs, _ := fs.Collection("chats").Where("participants", "array-contains", u.UID).Documents(ctx).GetAll()
		for _, doc := range docs {
			data := doc.Data()
			participants, _ := data["participants"].([]interface{})
			for _, participant := range participants {
				participantID, _ := participant.(string)
				if participantID != "" {
					if err := mirror.Revoke(ctx, doc.Ref.ID, participantID); err != nil {
						log.Printf("  Warning: could not revoke seed RTDB membership: %v", err)
					}
				}
			}

			// Firestore does not cascade document deletion into subcollections.
			msgDocs, _ := doc.Ref.Collection("messages").Documents(ctx).GetAll()
			memberDocs, _ := doc.Ref.Collection("members").Documents(ctx).GetAll()
			batch := fs.Batch()
			for _, msg := range msgDocs {
				batch.Delete(msg.Ref)
			}
			for _, member := range memberDocs {
				batch.Delete(member.Ref)
			}
			batch.Delete(doc.Ref)
			if _, err := batch.Commit(ctx); err != nil {
				log.Printf("  Warning: could not delete seed chat %s: %v", doc.Ref.ID, err)
			}
		}
	}

	// 2. Delete users from PostgreSQL
	uids := make([]string, len(users))
	for i, u := range users {
		uids[i] = u.UID
	}
	db.ExecContext(ctx, "DELETE FROM users WHERE id IN (SELECT unnest($1::text[]))", uids)

	// 3. Delete Firebase Auth users
	for _, u := range users {
		auth.DeleteUser(ctx, u.UID)
	}

	log.Printf("Cleaned up %d seed users and their data", len(users))
}

// ensureFirebaseUser creates a Firebase Auth user if not exists.
func ensureFirebaseUser(ctx context.Context, auth *firebaseAuth.Client, u seedUser) {
	_, err := auth.GetUser(ctx, u.UID)
	if err == nil {
		return // already exists
	}

	params := (&firebaseAuth.UserToCreate{}).
		UID(u.UID).
		Email(u.Email).
		EmailVerified(true).
		Password("password123").
		DisplayName(u.Username).
		Disabled(false)

	_, err = auth.CreateUser(ctx, params)
	if err != nil {
		log.Printf("  Warning: could not create Firebase user %s: %v", u.UID, err)
	}
}

// ensurePGUser upserts user to PostgreSQL.
func ensurePGUser(ctx context.Context, repo apprepo.UserRepository, u seedUser) {
	err := repo.Upsert(ctx, &models.User{
		ID:       u.UID,
		Email:    u.Email,
		Username: u.Username,
		Avatar:   "",
	})
	if err != nil {
		log.Printf("  Warning: could not upsert PG user %s: %v", u.UID, err)
	}
}

// ensureFirestoreUser writes user profile to Firestore.
func ensureFirestoreUser(ctx context.Context, fs *firestore.Client, u seedUser) {
	data := map[string]interface{}{
		"username":  u.Username,
		"email":     u.Email,
		"avatar":    "",
		"updatedAt": time.Now(),
	}
	_, err := fs.Collection("users").Doc(u.UID).Set(ctx, data, firestore.MergeAll)
	if err != nil {
		log.Printf("  Warning: could not write Firestore user %s: %v", u.UID, err)
	}
}

// ensureChat creates a chat in Firestore if not exists. Returns chatID.
func ensureChat(ctx context.Context, fs *firestore.Client, mirror firebaseInit.MembershipMirror, user1, user1Name, user2, user2Name string, isGroup bool, groupName string) string {
	// Check for existing DM in Firestore
	docs, _ := fs.Collection("chats").
		Where("participants", "array-contains", user1).
		Where("isGroup", "==", false).
		Documents(ctx).GetAll()
	for _, doc := range docs {
		data := doc.Data()
		participants, _ := data["participants"].([]interface{})
		for _, p := range participants {
			if p.(string) == user2 {
				ensureSeedMembership(ctx, fs, mirror, doc.Ref.ID, user1, user2)
				return doc.Ref.ID
			}
		}
	}

	chatID := uuid.New().String()
	participantProfiles := map[string]interface{}{
		user1: map[string]interface{}{"username": user1Name, "avatar": ""},
		user2: map[string]interface{}{"username": user2Name, "avatar": ""},
	}

	fsData := map[string]interface{}{
		"participants":        []string{user1, user2},
		"participantProfiles": participantProfiles,
		"isGroup":             isGroup,
		"groupName":           groupName,
		"createdBy":           user1,
		"initiator":           user1,
		"createdAt":           time.Now(),
		"updatedAt":           time.Now(),
		"lastMessage":         nil,
	}
	_, _ = fs.Collection("chats").Doc(chatID).Set(ctx, fsData)
	ensureSeedMembership(ctx, fs, mirror, chatID, user1, user2)

	return chatID
}

func ensureSeedMembership(
	ctx context.Context,
	fs *firestore.Client,
	mirror firebaseInit.MembershipMirror,
	chatID string,
	creatorID string,
	memberID string,
) {
	now := time.Now()
	batch := fs.Batch()
	for userID, role := range map[string]string{
		creatorID: "creator",
		memberID:  "member",
	} {
		batch.Set(
			fs.Collection("chats").Doc(chatID).Collection("members").Doc(userID),
			map[string]interface{}{
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
			},
		)
	}
	if _, err := batch.Commit(ctx); err != nil {
		log.Fatalf("create seed member documents for chat %s: %v", chatID, err)
	}

	for _, userID := range []string{creatorID, memberID} {
		if err := mirror.Grant(ctx, chatID, userID); err != nil {
			log.Fatalf("create seed RTDB membership for chat %s user %s: %v", chatID, userID, err)
		}
	}
}

// ensureMessages creates messages in Firestore from generated message data.
func ensureMessages(ctx context.Context, fs *firestore.Client, chatID string, msgs []map[string]interface{}) {
	for i, m := range msgs {
		msgID := uuid.New().String()
		senderID := m["senderID"].(string)
		senderName := m["senderName"].(string)
		text := m["text"].(string)
		createdAt := m["createdAt"].(time.Time)

		fsMsg := map[string]interface{}{
			"type":         "text",
			"senderId":     senderID,
			"senderName":   senderName,
			"senderAvatar": "",
			"content":      text,
			"createdAt":    createdAt,
		}
		_, _ = fs.Collection("chats").Doc(chatID).Collection("messages").Doc(msgID).Set(ctx, fsMsg)

		// Update lastMessage on chat doc after last message
		if i == len(msgs)-1 {
			_, _ = fs.Collection("chats").Doc(chatID).Update(ctx, []firestore.Update{
				{Path: "lastMessage", Value: map[string]interface{}{
					"senderId":   senderID,
					"senderName": senderName,
					"content":    text,
					"createdAt":  createdAt,
				}},
				{Path: "updatedAt", Value: createdAt},
			})
		}
	}
}
