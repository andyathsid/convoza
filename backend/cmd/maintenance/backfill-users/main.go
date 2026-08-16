// backfill-users repairs missing Firestore user records for existing PostgreSQL users.
// Run: go run ./cmd/maintenance/backfill-users
// Safe to re-run (idempotent).

package main

import (
	"context"
	"log"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/andyathsid/backend/platform/database"
	"github.com/andyathsid/backend/platform/database/repositories"
	firebaseInit "github.com/andyathsid/backend/platform/firebase"
	_ "github.com/joho/godotenv/autoload"
)

func main() {
	ctx := context.Background()

	if err := firebaseInit.InitFirebase(); err != nil {
		log.Fatalf("firebase init failed: %v", err)
	}

	fsClient, err := firebaseInit.App.Firestore(ctx)
	if err != nil {
		log.Fatalf("firestore init failed: %v", err)
	}
	defer fsClient.Close()

	db, err := database.OpenDBConnection()
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	userRepo := repositories.NewUserRepositorySQL(db)

	users, err := userRepo.GetAll(ctx, "")
	if err != nil {
		log.Fatalf("failed to fetch users: %v", err)
	}

	log.Printf("Found %d users to sync to Firestore", len(users))

	batch := fsClient.Batch()
	count := 0
	for _, u := range users {
		batch.Set(fsClient.Collection("users").Doc(u.ID), map[string]interface{}{
			"username":  u.Username,
			"email":     u.Email,
			"avatar":    u.Avatar,
			"updatedAt": time.Now(),
		}, firestore.MergeAll)
		count++

		if count%400 == 0 {
			_, err = batch.Commit(ctx)
			if err != nil {
				log.Fatalf("batch commit failed: %v", err)
			}
			batch = fsClient.Batch()
			log.Printf("Committed %d user writes...", count)
		}
	}

	if count%400 != 0 {
		_, err = batch.Commit(ctx)
		if err != nil {
			log.Fatalf("final batch commit failed: %v", err)
		}
	}

	log.Printf("Successfully synced %d users to Firestore users/ collection", count)
}
