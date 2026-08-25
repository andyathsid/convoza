package firebase

import (
	"context"
	"fmt"
	"log"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	application "github.com/andyathsid/backend/internal/app"
	"github.com/andyathsid/backend/internal/platform/config"
	"google.golang.org/api/option"
)

type Clients struct {
	App        *firebase.App
	Identity   application.IdentityProvider
	Membership application.MembershipMirror
	Storage    application.ObjectStore
}

var _ application.IdentityProvider = authAdapter{}
var _ application.MembershipMirror = (*rtdbMembershipMirror)(nil)
var _ application.ObjectStore = (*gcsStorageObjectInspector)(nil)

func NewApp(ctx context.Context, cfg config.Firebase) (*firebase.App, error) {
	if err := cfg.ValidateBase(); err != nil {
		return nil, err
	}
	firebaseConfig := &firebase.Config{
		ProjectID:     cfg.ProjectID,
		DatabaseURL:   cfg.DatabaseURL,
		StorageBucket: cfg.StorageBucket,
	}
	firebaseApp, err := firebase.NewApp(ctx, firebaseConfig, option.WithAuthCredentialsFile(option.ServiceAccount, cfg.ServiceAccountPath))
	if err != nil {
		return nil, fmt.Errorf("initialize Firebase Admin app: %w", err)
	}
	return firebaseApp, nil
}

func New(ctx context.Context, cfg config.Firebase) (*Clients, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	firebaseApp, err := NewApp(ctx, cfg)
	if err != nil {
		return nil, err
	}

	identity, err := firebaseApp.Auth(ctx)
	if err != nil {
		return nil, fmt.Errorf("initialize Firebase Authentication client: %w", err)
	}
	databaseClient, err := firebaseApp.Database(ctx)
	if err != nil {
		return nil, fmt.Errorf("initialize RTDB membership client: %w", err)
	}
	storage, err := newStorageObjectInspector(ctx, firebaseApp, cfg.StorageBucket)
	if err != nil {
		return nil, err
	}
	log.Printf("RTDB membership mirror initialized target=%s", cfg.DatabaseURL)
	log.Printf("Firebase Storage object inspector initialized bucket=%s", cfg.StorageBucket)
	log.Println("Firebase Admin SDK initialized successfully")
	return &Clients{App: firebaseApp, Identity: authAdapter{client: identity}, Membership: newMembershipMirror(databaseClient), Storage: storage}, nil
}

func NewMembershipMirror(ctx context.Context, firebaseApp *firebase.App) (application.MembershipMirror, error) {
	databaseClient, err := firebaseApp.Database(ctx)
	if err != nil {
		return nil, fmt.Errorf("initialize RTDB membership client: %w", err)
	}
	return newMembershipMirror(databaseClient), nil
}

type authAdapter struct{ client *auth.Client }

func (a authAdapter) VerifyIDToken(ctx context.Context, value string) (application.Identity, error) {
	token, err := a.client.VerifyIDToken(ctx, value)
	if err != nil {
		return application.Identity{}, err
	}
	return identityFromToken(token), nil
}

func (a authAdapter) CreateSessionCookie(ctx context.Context, idToken string, expiresIn time.Duration) (string, error) {
	return a.client.SessionCookie(ctx, idToken, expiresIn)
}

func (a authAdapter) VerifySessionCookie(ctx context.Context, value string) (application.Identity, error) {
	token, err := a.client.VerifySessionCookieAndCheckRevoked(ctx, value)
	if err != nil {
		return application.Identity{}, err
	}
	return identityFromToken(token), nil
}

func identityFromToken(token *auth.Token) application.Identity {
	identity := application.Identity{UID: token.UID}
	identity.Email, _ = token.Claims["email"].(string)
	identity.Name, _ = token.Claims["name"].(string)
	return identity
}
func (a authAdapter) GetUser(ctx context.Context, uid string) (application.Identity, error) {
	user, err := a.client.GetUser(ctx, uid)
	if err != nil {
		return application.Identity{}, err
	}
	identity := application.Identity{UID: user.UID, Email: user.Email, Name: user.DisplayName}
	for _, provider := range user.ProviderUserInfo {
		identity.Providers = append(identity.Providers, application.IdentityProviderProfile{ProviderID: provider.ProviderID, Email: provider.Email, DisplayName: provider.DisplayName, PhotoURL: provider.PhotoURL})
	}
	return identity, nil
}
