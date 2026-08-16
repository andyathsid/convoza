// backfill-users repairs missing Firestore user records for existing PostgreSQL users.
// Run: go run ./cmd/maintenance/backfill-users
// Safe to re-run (idempotent).

package main

import (
	"context"
	"log"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/andyathsid/backend/internal/platform/config"
	"github.com/andyathsid/backend/internal/platform/database"
	firebaseInit "github.com/andyathsid/backend/internal/platform/firebase"
	_ "github.com/joho/godotenv/autoload"
)

func main() {
	ctx := context.Background()

	cfg, err := config.LoadDatabaseAndFirebase()
	if err != nil {
		log.Fatalf("load configuration: %v", err)
	}
	firebaseApp, err := firebaseInit.NewApp(ctx, cfg.Firebase)
	if err != nil {
		log.Fatalf("firebase init failed: %v", err)
	}

	fsClient, err := firebaseApp.Firestore(ctx)
	if err != nil {
		log.Fatalf("firestore init failed: %v", err)
	}
	defer fsClient.Close()

	db, err := database.Open(cfg.Database)
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}
	defer db.Close()
	userRepo := database.NewUserRepositorySQL(db)

	users, err := userRepo.GetAll(ctx, "")
	if err != nil {
		log.Fatalf("failed to fetch users: %v", err)
	}

	log.Printf("Found %d users to sync to Firestore", len(users))

	for start := 0; start < len(users); start += 400 {
		end := min(start+400, len(users))
		err = fsClient.RunTransaction(ctx, func(_ context.Context, transaction *firestore.Transaction) error {
			for _, user := range users[start:end] {
				if err := transaction.Set(fsClient.Collection("users").Doc(user.ID), map[string]interface{}{
					"username":  user.Username,
					"email":     user.Email,
					"avatar":    user.Avatar,
					"updatedAt": time.Now(),
				}, firestore.MergeAll); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			log.Fatalf("sync users %d-%d: %v", start+1, end, err)
		}
		log.Printf("Committed %d user writes...", end)
	}

	log.Printf("Successfully synced %d users to Firestore users/ collection", len(users))
}
