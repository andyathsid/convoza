package firebase

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"

	"cloud.google.com/go/storage"
	firebase "firebase.google.com/go/v4"
)

type StorageObjectMetadata struct {
	Path           string
	ContentType    string
	Size           int64
	DownloadTokens []string
}

type StorageObjectInspector interface {
	BucketName() string
	Inspect(ctx context.Context, objectPath string) (*StorageObjectMetadata, error)
}

type StoredObject struct {
	Path        string
	DownloadURL string
}

type StorageObjectStore interface {
	StorageObjectInspector
	Upload(ctx context.Context, objectPath, contentType, downloadToken string, source io.Reader) (*StoredObject, error)
	Delete(ctx context.Context, objectPath string) error
}

type gcsStorageObjectInspector struct {
	bucketName string
	bucket     *storage.BucketHandle
}

func newStorageObjectInspector(
	ctx context.Context,
	app *firebase.App,
	bucketName string,
) (StorageObjectStore, error) {
	bucketName = strings.TrimSpace(bucketName)
	if bucketName == "" {
		return nil, fmt.Errorf("storage bucket name is required")
	}

	client, err := app.Storage(ctx)
	if err != nil {
		return nil, fmt.Errorf("initialize Firebase Storage client: %w", err)
	}
	bucket, err := client.Bucket(bucketName)
	if err != nil {
		return nil, fmt.Errorf("initialize Firebase Storage bucket %q: %w", bucketName, err)
	}

	return &gcsStorageObjectInspector{
		bucketName: bucketName,
		bucket:     bucket,
	}, nil
}

func (i *gcsStorageObjectInspector) Upload(
	ctx context.Context,
	objectPath string,
	contentType string,
	downloadToken string,
	source io.Reader,
) (*StoredObject, error) {
	writer := i.bucket.Object(objectPath).NewWriter(ctx)
	writer.ContentType = contentType
	writer.Metadata = map[string]string{"firebaseStorageDownloadTokens": downloadToken}

	if _, err := io.Copy(writer, source); err != nil {
		_ = writer.Close()
		_ = i.bucket.Object(objectPath).Delete(ctx)
		return nil, fmt.Errorf("upload Storage object %q: %w", objectPath, err)
	}
	if err := writer.Close(); err != nil {
		_ = i.bucket.Object(objectPath).Delete(ctx)
		return nil, fmt.Errorf("finalize Storage object %q: %w", objectPath, err)
	}

	return &StoredObject{
		Path: objectPath,
		DownloadURL: fmt.Sprintf(
			"https://firebasestorage.googleapis.com/v0/b/%s/o/%s?alt=media&token=%s",
			i.bucketName,
			url.QueryEscape(objectPath),
			url.QueryEscape(downloadToken),
		),
	}, nil
}

func (i *gcsStorageObjectInspector) Delete(ctx context.Context, objectPath string) error {
	err := i.bucket.Object(objectPath).Delete(ctx)
	if errors.Is(err, storage.ErrObjectNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("delete Storage object %q: %w", objectPath, err)
	}
	return nil
}

func (i *gcsStorageObjectInspector) BucketName() string {
	return i.bucketName
}

func (i *gcsStorageObjectInspector) Inspect(
	ctx context.Context,
	objectPath string,
) (*StorageObjectMetadata, error) {
	attrs, err := i.bucket.Object(objectPath).Attrs(ctx)
	if err != nil {
		return nil, fmt.Errorf("inspect Storage object %q: %w", objectPath, err)
	}

	return &StorageObjectMetadata{
		Path:           attrs.Name,
		ContentType:    attrs.ContentType,
		Size:           attrs.Size,
		DownloadTokens: splitDownloadTokens(attrs.Metadata["firebaseStorageDownloadTokens"]),
	}, nil
}

func splitDownloadTokens(value string) []string {
	var tokens []string
	for _, token := range strings.Split(value, ",") {
		token = strings.TrimSpace(token)
		if token != "" {
			tokens = append(tokens, token)
		}
	}
	return tokens
}
