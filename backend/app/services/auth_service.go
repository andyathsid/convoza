package services

import (
	"context"
	"fmt"
	"net/http"

	"github.com/andyathsid/backend/app/models"
	apprepo "github.com/andyathsid/backend/app/repository"
	firebaseUtil "github.com/andyathsid/backend/platform/firebase"
	fsClient "github.com/andyathsid/backend/platform/firestore"
	"github.com/andyathsid/backend/platform/search"
)

// AuthService handles Firebase token verification and user sync.
type AuthService struct {
	users     apprepo.UserRepository
	firestore *fsClient.FirestoreClient
	search    *search.SyncService // nil-safe
	storage   firebaseUtil.StorageObjectStore
}

// NewAuthService creates a new AuthService.
func NewAuthService(users apprepo.UserRepository, firestore *fsClient.FirestoreClient, searchSync *search.SyncService, storage firebaseUtil.StorageObjectStore) *AuthService {
	return &AuthService{users: users, firestore: firestore, search: searchSync, storage: storage}
}

func (s *AuthService) UpdateUserAvatar(ctx context.Context, userID string, upload StorageUpload) (*models.User, *firebaseUtil.StoredObject, error) {
	user, err := s.users.GetByID(ctx, userID)
	if err != nil {
		return nil, nil, &ServiceError{Status: http.StatusNotFound, Message: "user not found", Err: err}
	}
	previousAvatar := user.Avatar
	object, err := uploadStorageObject(ctx, s.storage, upload, fmt.Sprintf("users/%s/avatar/", userID), storageAvatar)
	if err != nil {
		return nil, nil, err
	}
	user.Avatar = object.DownloadURL
	if err := s.users.Upsert(ctx, &user); err != nil {
		_ = deleteStorageObject(context.Background(), s.storage, object.Path)
		return nil, nil, err
	}
	if err := s.firestore.WriteUserProfile(ctx, user.ID, user.Username, user.Email, user.Avatar); err != nil {
		// Restore the previous URL before cleanup, otherwise PostgreSQL would point at a deleted object.
		user.Avatar = previousAvatar
		if restoreErr := s.users.Upsert(ctx, &user); restoreErr != nil {
			return nil, nil, fmt.Errorf("restore avatar after Firestore failure: %w", restoreErr)
		}
		_ = deleteStorageObject(context.Background(), s.storage, object.Path)
		return nil, nil, err
	}
	return &user, object, nil
}

// AuthSyncOpts carries optional frontend-provided fields for user sync (e.g., username/avatar from registration form).
type AuthSyncOpts struct {
	Username   string
	Avatar     string
	AvatarPath string
	Email      string
}

// VerifyAndSyncUser verifies a Firebase ID token and syncs the user to PostgreSQL.
// opts is optional; pass nil for session restore where no field override is needed.
func (s *AuthService) VerifyAndSyncUser(ctx context.Context, idToken string, opts *AuthSyncOpts) (*models.User, error) {
	token, err := firebaseUtil.Auth.VerifyIDToken(ctx, idToken)
	if err != nil {
		return nil, &ServiceError{
			Status:  http.StatusUnauthorized,
			Message: "invalid or expired Firebase token",
			Err:     err,
		}
	}

	// Try to get existing user
	existingUser, err := s.users.GetByID(ctx, token.UID)
	isNewUser := err != nil

	var user models.User
	if isNewUser {
		// User doesn't exist yet, create from token claims
		email, _ := token.Claims["email"].(string)
		name, _ := token.Claims["name"].(string)
		if name == "" {
			name = email
		}

		// Fallback: fetch email from Firebase Admin SDK when token lacks it
		if email == "" {
			firebaseUser, err := firebaseUtil.Auth.GetUser(ctx, token.UID)
			if err == nil && len(firebaseUser.ProviderUserInfo) > 0 {
				for _, provider := range firebaseUser.ProviderUserInfo {
					if provider.Email != "" {
						email = provider.Email
						if name == "" && provider.DisplayName != "" {
							name = provider.DisplayName
						}
						break
					}
				}
			}
		}

		// Fallback to frontend-provided email if still empty
		if email == "" && opts != nil && opts.Email != "" {
			email = opts.Email
		}

		// Block sign-in if email is already registered under a different UID
		if existingByEmail, err := s.users.GetByEmail(ctx, email); err == nil && existingByEmail.ID != token.UID {
			return nil, &ServiceError{
				Status:  http.StatusConflict,
				Message: "This email is already registered with a different sign-in method. Please use your original provider.",
			}
		}

		user = models.User{
			ID:       token.UID,
			Email:    email,
			Username: name,
			Avatar:   "",
		}

	} else {
		user = existingUser
		// Fill in missing email from Firebase Admin SDK if needed
		if user.Email == "" {
			firebaseUser, err := firebaseUtil.Auth.GetUser(ctx, token.UID)
			if err == nil && len(firebaseUser.ProviderUserInfo) > 0 {
				for _, provider := range firebaseUser.ProviderUserInfo {
					if provider.Email != "" {
						user.Email = provider.Email
						break
					}
				}
			}
		}
	}

	// Override with frontend-provided values if available (e.g., registration form)
	if opts != nil {
		if opts.Username != "" {
			user.Username = opts.Username
		}
		if opts.Avatar != "" {
			if opts.AvatarPath != "" {
				avatarPrefix := fmt.Sprintf("users/%s/avatar/", token.UID)
				if err := validateStorageObject(ctx, s.storage, opts.Avatar, opts.AvatarPath, avatarPrefix, storageAvatar); err != nil {
					return nil, err
				}
			} else if !trustedProviderAvatar(ctx, token.UID, opts.Avatar) {
				return nil, &ServiceError{
					Status:  http.StatusBadRequest,
					Message: "avatar must be an uploaded user avatar or the verified provider avatar",
				}
			}
			user.Avatar = opts.Avatar
		}
		if opts.Email != "" && user.Email == "" {
			user.Email = opts.Email
		}
	}

	// Upsert user (handles both new users and profile updates)
	if err := s.users.Upsert(ctx, &user); err != nil {
		return nil, &ServiceError{
			Status:  http.StatusConflict,
			Message: "This email is already registered. Please sign in with your original provider.",
		}
	}

	_ = s.firestore.WriteUserProfile(ctx, user.ID, user.Username, user.Email, user.Avatar)

	// Index contact to Typesense (same write triggers both Firestore + Typesense)
	if s.search != nil {
		go func() {
			bg := context.Background()
			_ = s.search.IndexContact(bg, search.ContactIndexDoc{
				ID:       user.ID,
				Username: user.Username,
			})
		}()
	}

	return &user, nil
}

func trustedProviderAvatar(
	ctx context.Context,
	userID string,
	avatarURL string,
) bool {
	if firebaseUtil.Auth == nil {
		return false
	}

	user, err := firebaseUtil.Auth.GetUser(ctx, userID)
	if err != nil {
		return false
	}
	for _, provider := range user.ProviderUserInfo {
		// Provider-specific profiles are controlled by the identity provider,
		// unlike the top-level Firebase photo URL that clients may update.
		if provider.ProviderID != "password" && provider.PhotoURL == avatarURL {
			return true
		}
	}
	return false
}
