// cleanup-participant-profiles removes a retired Firestore field from existing chats.
// Run: go run ./cmd/maintenance/cleanup-participant-profiles
// Safe to re-run (idempotent).

package main

import (
	"context"
	"log"

	"cloud.google.com/go/firestore"
	"github.com/andyathsid/backend/internal/platform/config"
	firebaseInit "github.com/andyathsid/backend/internal/platform/firebase"
	_ "github.com/joho/godotenv/autoload"
)

func main() {
	ctx := context.Background()

	firebaseConfig, err := config.LoadFirebase()
	if err != nil {
		log.Fatal(err)
	}
	firebaseApp, err := firebaseInit.NewApp(ctx, firebaseConfig)
	if err != nil {
		log.Fatalf("firebase init failed: %v", err)
	}

	fsClient, err := firebaseApp.Firestore(ctx)
	if err != nil {
		log.Fatalf("firestore init failed: %v", err)
	}
	defer fsClient.Close()

	docs, err := fsClient.Collection("chats").Documents(ctx).GetAll()
	if err != nil {
		log.Fatalf("failed to fetch chats: %v", err)
	}

	log.Printf("Found %d chat documents to clean", len(docs))

	refs := make([]*firestore.DocumentRef, 0, len(docs))
	for _, doc := range docs {
		data := doc.Data()
		if _, exists := data["participantProfiles"]; !exists {
			continue
		}
		refs = append(refs, doc.Ref)
	}

	for start := 0; start < len(refs); start += 400 {
		end := min(start+400, len(refs))
		err = fsClient.RunTransaction(ctx, func(_ context.Context, transaction *firestore.Transaction) error {
			for _, ref := range refs[start:end] {
				if err := transaction.Update(ref, []firestore.Update{
					{Path: "participantProfiles", Value: firestore.Delete},
				}); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			log.Fatalf("clean chats %d-%d: %v", start+1, end, err)
		}
		log.Printf("Cleaned %d chats...", end)
	}

	log.Printf("Successfully removed participantProfiles from %d chat documents", len(refs))
}
