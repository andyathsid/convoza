package firestore

import (
	"context"
	"errors"
	"log"
	"time"

	"cloud.google.com/go/firestore"
	firebase "firebase.google.com/go/v4"
	"github.com/andyathsid/backend/internal/domain"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type FirestoreClient struct {
	Client *firestore.Client
}

var (
	_ domain.ChatRepository        = (*FirestoreClient)(nil)
	_ domain.MessageRepository     = (*FirestoreClient)(nil)
	_ domain.UserProfileRepository = (*FirestoreClient)(nil)
)

func NewFirestoreClient(app *firebase.App) (*FirestoreClient, error) {
	client, err := app.Firestore(context.Background())
	if err != nil {
		return nil, err
	}
	log.Println("Firestore client initialized successfully")
	return &FirestoreClient{Client: client}, nil
}

func (fs *FirestoreClient) Close() error { return fs.Client.Close() }

func (fs *FirestoreClient) runAtomic(ctx context.Context, write func(*firestore.Transaction) error) error {
	err := fs.Client.RunTransaction(ctx, func(_ context.Context, transaction *firestore.Transaction) error {
		return write(transaction)
	})
	return mapFirestoreError(err)
}

func mapFirestoreError(err error) error {
	if err == nil {
		return nil
	}
	if status.Code(err) == codes.NotFound {
		return errors.Join(domain.ErrNotFound, err)
	}
	if status.Code(err) == codes.AlreadyExists {
		return errors.Join(domain.ErrConflict, err)
	}
	return err
}

func stringValue(value any) string {
	result, _ := value.(string)
	return result
}

func boolValue(value any) bool {
	result, _ := value.(bool)
	return result
}

func interfaceStringSlice(value any) []string {
	switch values := value.(type) {
	case []string:
		return append([]string(nil), values...)
	case []any:
		result := make([]string, 0, len(values))
		for _, value := range values {
			if text, ok := value.(string); ok {
				result = append(result, text)
			}
		}
		return result
	default:
		return nil
	}
}

func mapKeys(value any) []string {
	keys := []string{}
	switch values := value.(type) {
	case map[string]any:
		for key := range values {
			keys = append(keys, key)
		}
	case map[string]time.Time:
		for key := range values {
			keys = append(keys, key)
		}
	}
	return keys
}
