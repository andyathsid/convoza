package app

import (
	"context"
	"errors"
	"fmt"

	models "github.com/andyathsid/backend/internal/domain"
)

// AuthService handles Firebase token verification and user sync.
type AuthService struct {
	users    models.UserRepository
	profiles models.UserProfileRepository
	identity IdentityProvider
	search   SearchIndexer
	storage  ObjectStore
}

// NewAuthService creates a new AuthService.
func NewAuthService(users models.UserRepository, profiles models.UserProfileRepository, identity IdentityProvider, search SearchIndexer, storage ObjectStore) *AuthService {
	if search == nil {
		search = NopSearchIndexer{}
	}
	return &AuthService{users: users, profiles: profiles, identity: identity, search: search, storage: storage}
}

func (s *AuthService) UpdateUserAvatar(ctx context.Context, userID string, upload StorageUpload) (*models.User, *StoredObject, error) {
	user, err := s.users.GetByID(ctx, userID)
	if errors.Is(err, models.ErrNotFound) {
		return nil, nil, NotFound("user not found", err)
	}
	if err != nil {
		return nil, nil, DependencyUnavailable("user could not be loaded", err)
	}
	previousAvatar := user.Avatar
	object, err := uploadStorageObject(ctx, s.storage, upload, fmt.Sprintf("users/%s/avatar/", userID), storageAvatar)
	if err != nil {
		return nil, nil, err
	}
	user.Avatar = object.DownloadURL
	if err := s.users.Upsert(ctx, &user); err != nil {
		_ = deleteStorageObject(context.Background(), s.storage, object.Path)
		return nil, nil, userWriteError(err)
	}
	if err := s.profiles.WriteUserProfile(ctx, user); err != nil {
		// Restore the previous URL before cleanup, otherwise PostgreSQL would point at a deleted object.
		user.Avatar = previousAvatar
		if restoreErr := s.users.Upsert(ctx, &user); restoreErr != nil {
			return nil, nil, DependencyUnavailable("avatar update could not be rolled back", errors.Join(err, restoreErr))
		}
		_ = deleteStorageObject(context.Background(), s.storage, object.Path)
		return nil, nil, DependencyUnavailable("user profile could not be updated", err)
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
	token, err := s.identity.VerifyIDToken(ctx, idToken)
	if err != nil {
		return nil, Unauthenticated("invalid or expired Firebase token", err)
	}

	// Try to get existing user
	existingUser, err := s.users.GetByID(ctx, token.UID)
	isNewUser := errors.Is(err, models.ErrNotFound)
	if err != nil && !isNewUser {
		return nil, DependencyUnavailable("user could not be loaded", err)
	}

	var user models.User
	if isNewUser {
		// User doesn't exist yet, create from token claims
		email := token.Email
		name := token.Name
		if name == "" {
			name = email
		}

		// Fallback: fetch email from Firebase Admin SDK when token lacks it
		if email == "" {
			firebaseUser, err := s.identity.GetUser(ctx, token.UID)
			if err == nil && len(firebaseUser.Providers) > 0 {
				for _, provider := range firebaseUser.Providers {
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
		if email != "" {
			existingByEmail, lookupErr := s.users.GetByEmail(ctx, email)
			switch {
			case lookupErr == nil && existingByEmail.ID != token.UID:
				return nil, Conflict("This email is already registered with a different sign-in method. Please use your original provider.", nil)
			case lookupErr != nil && !errors.Is(lookupErr, models.ErrNotFound):
				return nil, DependencyUnavailable("email availability could not be checked", lookupErr)
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
			firebaseUser, err := s.identity.GetUser(ctx, token.UID)
			if err == nil && len(firebaseUser.Providers) > 0 {
				for _, provider := range firebaseUser.Providers {
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
			} else if !s.trustedProviderAvatar(ctx, token.UID, opts.Avatar) {
				return nil, InvalidInput("avatar must be an uploaded user avatar or the verified provider avatar", nil)
			}
			user.Avatar = opts.Avatar
		}
		if opts.Email != "" && user.Email == "" {
			user.Email = opts.Email
		}
	}

	// Upsert user (handles both new users and profile updates)
	if err := s.users.Upsert(ctx, &user); err != nil {
		return nil, userWriteError(err)
	}

	if err := s.profiles.WriteUserProfile(ctx, user); err != nil {
		return nil, DependencyUnavailable("user profile could not be synchronized", err)
	}

	// Index contact to Typesense (same write triggers both Firestore + Typesense)
	go func(user models.User) { _ = s.search.IndexContact(context.Background(), user) }(user)

	return &user, nil
}

func userWriteError(err error) error {
	if errors.Is(err, models.ErrConflict) {
		return Conflict("This email is already registered. Please sign in with your original provider.", err)
	}
	return DependencyUnavailable("user could not be saved", err)
}

func (s *AuthService) trustedProviderAvatar(
	ctx context.Context,
	userID string,
	avatarURL string,
) bool {
	user, err := s.identity.GetUser(ctx, userID)
	if err != nil {
		return false
	}
	for _, provider := range user.Providers {
		// Provider-specific profiles are controlled by the identity provider,
		// unlike the top-level Firebase photo URL that clients may update.
		if provider.ProviderID != "password" && provider.PhotoURL == avatarURL {
			return true
		}
	}
	return false
}
