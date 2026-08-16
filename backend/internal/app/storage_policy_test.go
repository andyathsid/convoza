package app

import (
	"context"
	"fmt"
	"net/url"
	"testing"
)

const (
	testBucket   = "chatapp.firebasestorage.app"
	testObjectID = "11111111-1111-4111-8111-111111111111"
)

type fakeStorageInspector struct {
	bucket   string
	metadata *StorageObjectMetadata
	err      error
}

func (i *fakeStorageInspector) BucketName() string {
	return i.bucket
}

func (i *fakeStorageInspector) Inspect(
	_ context.Context,
	_ string,
) (*StorageObjectMetadata, error) {
	return i.metadata, i.err
}

func firebaseDownloadURL(bucket, objectPath string) string {
	return fmt.Sprintf(
		"https://firebasestorage.googleapis.com/v0/b/%s/o/%s?alt=media&token=test-token",
		url.PathEscape(bucket),
		url.PathEscape(objectPath),
	)
}

func TestValidateStorageObject(t *testing.T) {
	objectPath := "chats/chat-a/media/alice/" + testObjectID
	inspector := &fakeStorageInspector{
		bucket: testBucket,
		metadata: &StorageObjectMetadata{
			Path:           objectPath,
			ContentType:    "image/jpeg",
			Size:           1024,
			DownloadTokens: []string{"test-token"},
		},
	}

	err := validateStorageObject(
		context.Background(),
		inspector,
		firebaseDownloadURL(testBucket, objectPath),
		objectPath,
		"chats/chat-a/media/alice/",
		storageImage,
	)
	if err != nil {
		t.Fatalf("validate known Storage object: %v", err)
	}
}

func TestValidateStorageObjectRejectsUntrustedMetadata(t *testing.T) {
	basePath := "chats/chat-a/media/alice/" + testObjectID
	tests := []struct {
		name        string
		downloadURL string
		objectPath  string
		metadata    *StorageObjectMetadata
	}{
		{
			name:        "wrong bucket",
			downloadURL: firebaseDownloadURL("other.firebasestorage.app", basePath),
			objectPath:  basePath,
			metadata:    validTestMetadata(basePath),
		},
		{
			name:        "wrong user path",
			downloadURL: firebaseDownloadURL(testBucket, basePath),
			objectPath:  basePath,
			metadata:    validTestMetadata(basePath),
		},
		{
			name:        "malformed file ID",
			downloadURL: firebaseDownloadURL(testBucket, "chats/chat-a/media/alice/not-a-uuid"),
			objectPath:  "chats/chat-a/media/alice/not-a-uuid",
			metadata:    validTestMetadata("chats/chat-a/media/alice/not-a-uuid"),
		},
		{
			name:        "URL object mismatch",
			downloadURL: firebaseDownloadURL(testBucket, "chats/chat-a/media/alice/22222222-2222-4222-8222-222222222222"),
			objectPath:  basePath,
			metadata:    validTestMetadata(basePath),
		},
		{
			name:        "download token mismatch",
			downloadURL: firebaseDownloadURL(testBucket, basePath),
			objectPath:  basePath,
			metadata: &StorageObjectMetadata{
				Path:           basePath,
				ContentType:    "image/jpeg",
				Size:           1024,
				DownloadTokens: []string{"different-token"},
			},
		},
		{
			name:        "disallowed MIME",
			downloadURL: firebaseDownloadURL(testBucket, basePath),
			objectPath:  basePath,
			metadata: &StorageObjectMetadata{
				Path:           basePath,
				ContentType:    "application/octet-stream",
				Size:           1024,
				DownloadTokens: []string{"test-token"},
			},
		},
		{
			name:        "oversized",
			downloadURL: firebaseDownloadURL(testBucket, basePath),
			objectPath:  basePath,
			metadata: &StorageObjectMetadata{
				Path:           basePath,
				ContentType:    "image/jpeg",
				Size:           storageSizeLimits[storageImage] + 1,
				DownloadTokens: []string{"test-token"},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			inspector := &fakeStorageInspector{
				bucket:   testBucket,
				metadata: test.metadata,
			}
			expectedPrefix := "chats/chat-a/media/alice/"
			if test.name == "wrong user path" {
				expectedPrefix = "chats/chat-a/media/bob/"
			}

			err := validateStorageObject(
				context.Background(),
				inspector,
				test.downloadURL,
				test.objectPath,
				expectedPrefix,
				storageImage,
			)
			if err == nil {
				t.Fatal("expected Storage object validation to fail")
			}
		})
	}
}

func validTestMetadata(objectPath string) *StorageObjectMetadata {
	return &StorageObjectMetadata{
		Path:           objectPath,
		ContentType:    "image/jpeg",
		Size:           1024,
		DownloadTokens: []string{"test-token"},
	}
}
