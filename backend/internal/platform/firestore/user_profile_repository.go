package firestore

import (
	"context"
	"time"

	googlefirestore "cloud.google.com/go/firestore"
	"github.com/andyathsid/backend/internal/domain"
)

func (fs *FirestoreClient) WriteUserProfile(ctx context.Context, user domain.User) error {
	_, err := fs.Client.Collection("users").Doc(user.ID).Set(ctx, map[string]any{
		"username": user.Username, "email": user.Email, "avatar": user.Avatar, "updatedAt": time.Now(),
	}, googlefirestore.MergeAll)
	return mapFirestoreError(err)
}

func (fs *FirestoreClient) GetUserProfiles(ctx context.Context, userIDs []string) (map[string]domain.UserProfile, error) {
	profiles := make(map[string]domain.UserProfile, len(userIDs))
	if len(userIDs) == 0 {
		return profiles, nil
	}
	refs := make([]*googlefirestore.DocumentRef, len(userIDs))
	for index, userID := range userIDs {
		refs[index] = fs.Client.Collection("users").Doc(userID)
	}
	documents, err := fs.Client.GetAll(ctx, refs)
	if err != nil {
		return nil, mapFirestoreError(err)
	}
	for index, document := range documents {
		if !document.Exists() {
			continue
		}
		data := document.Data()
		profiles[userIDs[index]] = domain.UserProfile{
			UserID: userIDs[index], Username: stringValue(data["username"]),
			Email: stringValue(data["email"]), Avatar: stringValue(data["avatar"]),
		}
	}
	return profiles, nil
}
