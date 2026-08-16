// reconcile-user-profiles normalizes the public Firestore profile directory.
// Run with --apply after reviewing the default dry-run output.
package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/andyathsid/backend/internal/platform/config"
	firebaseInit "github.com/andyathsid/backend/internal/platform/firebase"
	_ "github.com/joho/godotenv/autoload"
	"google.golang.org/api/iterator"
)

func main() {
	apply := flag.Bool("apply", false, "write normalized Firestore profiles")
	flag.Parse()

	ctx := context.Background()
	cfg, err := config.LoadFirebase()
	if err != nil {
		log.Fatalf("load configuration: %v", err)
	}
	app, err := firebaseInit.NewApp(ctx, cfg)
	if err != nil {
		log.Fatalf("firebase init failed: %v", err)
	}
	fs, err := app.Firestore(ctx)
	if err != nil {
		log.Fatalf("firestore init failed: %v", err)
	}
	defer fs.Close()
	authClient, err := app.Auth(ctx)
	if err != nil {
		log.Fatalf("auth init failed: %v", err)
	}

	profiles, err := fs.Collection("users").Documents(ctx).GetAll()
	if err != nil {
		log.Fatalf("load Firestore profiles: %v", err)
	}
	existing := make(map[string]map[string]any, len(profiles))
	for _, profile := range profiles {
		existing[profile.Ref.ID] = profile.Data()
	}

	updated := 0
	users := authClient.Users(ctx, "")
	for {
		record, err := users.Next()
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			log.Fatalf("list Firebase users: %v", err)
		}
		data, found := existing[record.UID]
		username := strings.TrimSpace(stringValue(data["username"]))
		if username == "" {
			username = strings.TrimSpace(record.DisplayName)
		}
		if username == "" {
			username = "User"
		}
		update := map[string]any{
			"username":           username,
			"usernameNormalized": strings.ToLower(username),
			"avatar":             stringValue(data["avatar"]),
			"email":              firestore.Delete,
		}
		if !found || timeValue(data["createdAt"]).IsZero() {
			update["createdAt"] = time.UnixMilli(record.UserMetadata.CreationTimestamp)
		}
		if !found || timeValue(data["updatedAt"]).IsZero() {
			update["updatedAt"] = time.Now()
		}
		updated++
		if *apply {
			if _, err := fs.Collection("users").Doc(record.UID).Set(ctx, update, firestore.MergeAll); err != nil {
				log.Fatalf("write profile %s: %v", record.UID, err)
			}
		}
		delete(existing, record.UID)
	}

	for userID := range existing {
		log.Printf("orphan Firestore profile retained userID=%s", userID)
	}
	mode := "dry run"
	if *apply {
		mode = "applied"
	}
	log.Printf("profile reconciliation %s: %d Firebase users, %d orphan profiles", mode, updated, len(existing))
}

func stringValue(value any) string {
	result, _ := value.(string)
	return result
}

func timeValue(value any) time.Time {
	result, _ := value.(time.Time)
	return result
}
