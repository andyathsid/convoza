package app

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/google/uuid"
)

type StorageUpload struct {
	Source      io.Reader
	Size        int64
	ContentType string
}

func uploadStorageObject(ctx context.Context, store ObjectStore, upload StorageUpload, prefix string, kind storageObjectKind) (*StoredObject, error) {
	if store == nil {
		return nil, DependencyUnavailable("Storage is unavailable", nil)
	}
	if upload.Source == nil || upload.Size <= 0 {
		return nil, InvalidInput("file is empty", nil)
	}
	maxSize, ok := storageSizeLimits[kind]
	if !ok {
		return nil, InvalidInput("file type is not allowed", nil)
	}
	if upload.Size > maxSize {
		return nil, PayloadTooLarge("file exceeds the allowed size", nil)
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(upload.ContentType, ";")[0]))
	if !storageContentTypes[kind][contentType] {
		return nil, InvalidInput("file content type is not allowed", nil)
	}
	object, err := store.Upload(ctx, prefix+uuid.NewString(), contentType, uuid.NewString(), io.LimitReader(upload.Source, maxSize+1))
	if err != nil {
		return nil, DependencyUnavailable("file upload failed", err)
	}
	return object, nil
}

func deleteStorageObject(ctx context.Context, store ObjectStore, objectPath string) error {
	if objectPath == "" {
		return nil
	}
	if store == nil {
		return DependencyUnavailable("Storage is unavailable", nil)
	}
	if err := store.Delete(ctx, objectPath); err != nil {
		return DependencyUnavailable("file deletion failed", err)
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
