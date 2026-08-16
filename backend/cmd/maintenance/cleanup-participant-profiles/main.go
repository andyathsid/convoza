// cleanup-participant-profiles removes a retired Firestore field from existing chats.
// Run: go run ./cmd/maintenance/cleanup-participant-profiles
// Safe to re-run (idempotent).

package main

import (
	"context"
	"log"

	"cloud.google.com/go/firestore"
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

	docs, err := fsClient.Collection("chats").Documents(ctx).GetAll()
	if err != nil {
		log.Fatalf("failed to fetch chats: %v", err)
	}

	log.Printf("Found %d chat documents to clean", len(docs))

	batch := fsClient.Batch()
	count := 0
	for _, doc := range docs {
		data := doc.Data()
		if _, exists := data["participantProfiles"]; !exists {
			continue
		}

		batch.Update(doc.Ref, []firestore.Update{
			{Path: "participantProfiles", Value: firestore.Delete},
		})
		count++

		if count%400 == 0 {
			_, err = batch.Commit(ctx)
			if err != nil {
				log.Fatalf("batch commit failed: %v", err)
			}
			batch = fsClient.Batch()
			log.Printf("Cleaned %d chats...", count)
		}
	}

	if count%400 != 0 {
		_, err = batch.Commit(ctx)
		if err != nil {
			log.Fatalf("final batch commit failed: %v", err)
		}
	}

	log.Printf("Successfully removed participantProfiles from %d chat documents", count)
}
