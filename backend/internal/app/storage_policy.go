package app

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/google/uuid"
)

type storageObjectKind string

const (
	storageAvatar    storageObjectKind = "avatar"
	storageImage     storageObjectKind = "image"
	storageVideo     storageObjectKind = "video"
	storageAudio     storageObjectKind = "audio"
	storageDocument  storageObjectKind = "document"
	storageThumbnail storageObjectKind = "thumbnail"
)

var storageSizeLimits = map[storageObjectKind]int64{
	storageAvatar:    5 * 1024 * 1024,
	storageImage:     10 * 1024 * 1024,
	storageVideo:     10 * 1024 * 1024,
	storageAudio:     15 * 1024 * 1024,
	storageDocument:  25 * 1024 * 1024,
	storageThumbnail: 1 * 1024 * 1024,
}

var storageContentTypes = map[storageObjectKind]map[string]bool{
	storageAvatar: {
		"image/jpeg": true, "image/png": true, "image/webp": true, "image/gif": true,
	},
	storageImage: {
		"image/jpeg": true, "image/png": true, "image/webp": true, "image/gif": true,
	},
	storageVideo: {
		"video/mp4": true, "video/webm": true, "video/quicktime": true,
	},
	storageAudio: {
		"audio/webm": true, "audio/mpeg": true, "audio/mp4": true,
		"audio/wav": true, "audio/x-wav": true, "audio/ogg": true, "audio/aac": true,
	},
	storageDocument: {
		"application/pdf":    true,
		"application/msword": true,
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
		"application/vnd.ms-excel": true,
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":         true,
		"application/vnd.ms-powerpoint":                                             true,
		"application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
		"text/plain": true,
	},
	storageThumbnail: {
		"image/jpeg": true,
	},
}

func validateStorageObject(
	ctx context.Context,
	inspector StorageInspector,
	downloadURL string,
	objectPath string,
	expectedPrefix string,
	kind storageObjectKind,
) error {
	if inspector == nil {
		return DependencyUnavailable("Storage object verification is unavailable", nil)
	}
	if err := validateStoragePath(objectPath, expectedPrefix); err != nil {
		return invalidStorageObject(err)
	}
	downloadToken, err := validateFirebaseDownloadURL(downloadURL, inspector.BucketName(), objectPath)
	if err != nil {
		return invalidStorageObject(err)
	}

	metadata, err := inspector.Inspect(ctx, objectPath)
	if err != nil {
		return DependencyUnavailable("Uploaded file could not be verified", err)
	}
	if metadata.Path != objectPath {
		return invalidStorageObject(fmt.Errorf("Storage object path does not match uploaded object"))
	}
	if !containsString(metadata.DownloadTokens, downloadToken) {
		return invalidStorageObject(fmt.Errorf("Storage download URL token does not match the uploaded object"))
	}
	if metadata.Size <= 0 || metadata.Size > storageSizeLimits[kind] {
		return invalidStorageObject(fmt.Errorf("Storage object size is not allowed"))
	}
	if !storageContentTypes[kind][metadata.ContentType] {
		return invalidStorageObject(fmt.Errorf("Storage object content type is not allowed"))
	}

	return nil
}

func validateStoragePath(objectPath, expectedPrefix string) error {
	if !strings.HasPrefix(objectPath, expectedPrefix) {
		return fmt.Errorf("Storage object is outside the authorized path")
	}

	fileID := strings.TrimPrefix(objectPath, expectedPrefix)
	if strings.Contains(fileID, "/") {
		return fmt.Errorf("Storage object path has unexpected descendants")
	}
	parsedID, err := uuid.Parse(fileID)
	if err != nil || parsedID.Version() != 4 {
		return fmt.Errorf("Storage object file ID must be a UUID v4")
	}

	return nil
}

func validateFirebaseDownloadURL(downloadURL, bucketName, objectPath string) (string, error) {
	parsed, err := url.Parse(downloadURL)
	if err != nil {
		return "", fmt.Errorf("Storage download URL is malformed")
	}
	if parsed.Scheme != "https" ||
		parsed.Host != "firebasestorage.googleapis.com" ||
		parsed.User != nil ||
		parsed.Fragment != "" {
		return "", fmt.Errorf("Storage download URL must use Firebase Storage")
	}

	escapedPath := strings.TrimPrefix(parsed.EscapedPath(), "/v0/b/")
	parts := strings.SplitN(escapedPath, "/o/", 2)
	if len(parts) != 2 {
		return "", fmt.Errorf("Storage download URL path is malformed")
	}
	bucket, err := url.PathUnescape(parts[0])
	if err != nil || bucket != bucketName {
		return "", fmt.Errorf("Storage download URL targets an unexpected bucket")
	}
	object, err := url.PathUnescape(parts[1])
	if err != nil || object != objectPath {
		return "", fmt.Errorf("Storage download URL targets an unexpected object")
	}

	query := parsed.Query()
	if query.Get("alt") != "media" || query.Get("token") == "" {
		return "", fmt.Errorf("Storage download URL is missing its media token")
	}

	return query.Get("token"), nil
}

func invalidStorageObject(err error) error {
	return InvalidInput(err.Error(), err)
}

func storageKindForMediaType(mediaType string) (storageObjectKind, bool) {
	switch mediaType {
	case "image":
		return storageImage, true
	case "video":
		return storageVideo, true
	case "audio":
		return storageAudio, true
	case "document":
		return storageDocument, true
	default:
		return "", false
	}
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
