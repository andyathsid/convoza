package services

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"

	firebaseClient "github.com/andyathsid/backend/platform/firebase"
	"github.com/google/uuid"
)

type StorageUpload struct {
	Source      io.Reader
	Size        int64
	ContentType string
}

func uploadStorageObject(ctx context.Context, store firebaseClient.StorageObjectStore, upload StorageUpload, prefix string, kind storageObjectKind) (*firebaseClient.StoredObject, error) {
	if store == nil {
		return nil, &ServiceError{Status: http.StatusBadGateway, Message: "Storage is unavailable"}
	}
	if upload.Source == nil || upload.Size <= 0 {
		return nil, &ServiceError{Status: http.StatusBadRequest, Message: "file is empty"}
	}
	maxSize, ok := storageSizeLimits[kind]
	if !ok {
		return nil, &ServiceError{Status: http.StatusBadRequest, Message: "file type is not allowed"}
	}
	if upload.Size > maxSize {
		return nil, &ServiceError{Status: http.StatusRequestEntityTooLarge, Message: "file exceeds the allowed size"}
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(upload.ContentType, ";")[0]))
	if !storageContentTypes[kind][contentType] {
		return nil, &ServiceError{Status: http.StatusBadRequest, Message: "file content type is not allowed"}
	}
	object, err := store.Upload(ctx, prefix+uuid.NewString(), contentType, uuid.NewString(), io.LimitReader(upload.Source, maxSize+1))
	if err != nil {
		return nil, &ServiceError{Status: http.StatusBadGateway, Message: "file upload failed", Err: err}
	}
	return object, nil
}

func deleteStorageObject(ctx context.Context, store firebaseClient.StorageObjectStore, objectPath string) error {
	if objectPath == "" {
		return nil
	}
	if store == nil {
		return &ServiceError{Status: http.StatusBadGateway, Message: "Storage is unavailable"}
	}
	if err := store.Delete(ctx, objectPath); err != nil {
		return &ServiceError{Status: http.StatusBadGateway, Message: "file deletion failed", Err: err}
	}
	return nil
}

func validateMessageStoragePath(objectPath, chatID, userID, category string) error {
	return validateStoragePath(objectPath, fmt.Sprintf("chats/%s/%s/%s/", chatID, category, userID))
}

func validateChatStoragePath(objectPath, chatID, category string) error {
	parts := strings.Split(objectPath, "/")
	if len(parts) != 5 || parts[0] != "chats" || parts[1] != chatID || parts[2] != category || parts[3] == "" {
		return fmt.Errorf("Storage object is outside the authorized chat path")
	}
	fileID, err := uuid.Parse(parts[4])
	if err != nil || fileID.Version() != 4 {
		return fmt.Errorf("Storage object file ID must be a UUID v4")
	}
	return nil
}
