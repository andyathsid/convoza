package firebase

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

var (
	App                  *firebase.App
	Auth                 *auth.Client
	RTDBMembershipMirror MembershipMirror
	StorageObjects       StorageObjectStore
)

func InitFirebase() error {
	ctx := context.Background()

	credFile := os.Getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
	if credFile == "" {
		credFile = "firebase-service-account.json"
	}

	opt := option.WithCredentialsFile(credFile)
	var err error
	App, err = firebase.NewApp(ctx, nil, opt)
	if err != nil {
		return err
	}

	Auth, err = App.Auth(ctx)
	if err != nil {
		return err
	}

	databaseURL := strings.TrimSpace(os.Getenv("FIREBASE_DATABASE_URL"))
	if databaseURL == "" {
		return fmt.Errorf("FIREBASE_DATABASE_URL is required for RTDB membership synchronization")
	}

	databaseClient, err := App.DatabaseWithURL(ctx, databaseURL)
	if err != nil {
		return fmt.Errorf("initialize RTDB membership client: %w", err)
	}

	RTDBMembershipMirror = newMembershipMirror(databaseClient)

	storageBucket := strings.TrimSpace(os.Getenv("FIREBASE_STORAGE_BUCKET"))
	StorageObjects, err = newStorageObjectInspector(ctx, App, storageBucket)
	if err != nil {
		return err
	}

	log.Printf("RTDB membership mirror initialized target=%s", databaseURL)
	log.Printf("Firebase Storage object inspector initialized bucket=%s", storageBucket)
	log.Println("Firebase Admin SDK initialized successfully")
	return nil
}
