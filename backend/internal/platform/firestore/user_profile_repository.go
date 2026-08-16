package firestore

import (
	"context"
	"strings"
	"time"

	googlefirestore "cloud.google.com/go/firestore"
	"github.com/andyathsid/backend/internal/domain"
)

var _ domain.UserRepository = (*FirestoreClient)(nil)

// GetByID loads the public profile associated with a Firebase UID. Email is
// deliberately absent because Firebase Auth owns private account identity.
func (fs *FirestoreClient) GetByID(ctx context.Context, userID string) (domain.User, error) {
	document, err := fs.Client.Collection("users").Doc(userID).Get(ctx)
	if err != nil {
		return domain.User{}, mapFirestoreError(err)
	}
	if !document.Exists() {
		return domain.User{}, domain.ErrNotFound
	}
	data := document.Data()
	user := domain.User{
		ID:       userID,
		Username: stringValue(data["username"]),
		Avatar:   stringValue(data["avatar"]),
	}
	if createdAt := timeValue(data["createdAt"]); !createdAt.IsZero() {
		user.CreatedAt = createdAt
	}
	if updatedAt := timeValue(data["updatedAt"]); !updatedAt.IsZero() {
		user.UpdatedAt = &updatedAt
	}
	return user, nil
}

// Upsert writes only public profile fields. Keeping email out of Firestore
// prevents authenticated clients from using profile reads as an email directory.
func (fs *FirestoreClient) Upsert(ctx context.Context, user *domain.User) error {
	ref := fs.Client.Collection("users").Doc(user.ID)
	now := time.Now()
	return mapFirestoreError(fs.Client.RunTransaction(ctx, func(ctx context.Context, transaction *googlefirestore.Transaction) error {
		document, err := transaction.Get(ref)
		if err != nil {
			return err
		}
		data := map[string]any{
			"username":           user.Username,
			"usernameNormalized": strings.ToLower(strings.TrimSpace(user.Username)),
			"avatar":             user.Avatar,
			"updatedAt":          now,
			"email":              googlefirestore.Delete,
		}
		if !document.Exists() {
			data["createdAt"] = now
			user.CreatedAt = now
		}
		user.UpdatedAt = &now
		return transaction.Set(ref, data, googlefirestore.MergeAll)
	}))
}

func (fs *FirestoreClient) WriteUserProfile(ctx context.Context, user domain.User) error {
	return fs.Upsert(ctx, &user)
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
			Avatar: stringValue(data["avatar"]),
		}
	}
	return profiles, nil
}
