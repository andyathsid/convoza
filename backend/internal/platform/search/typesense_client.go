package search

import (
	"log"
	"net/url"

	"github.com/andyathsid/backend/internal/platform/config"
	"github.com/typesense/typesense-go/v3/typesense"
)

// NewTypesenseClient creates a Typesense client from environment variables.
// Reads TYPESENSE_URL (or TYPESENSE_HOST/TYPESENSE_PORT) and TYPESENSE_API_KEY.
func NewTypesenseClient(cfg config.Search) *typesense.Client {
	var serverURL string

	if u := cfg.URL; u != "" {
		serverURL = u
	} else {
		host := "localhost"
		port := "8108"
		protocol := "http"
		serverURL = protocol + "://" + host + ":" + port
	}

	// Normalize: strip trailing slash
	if parsed, err := url.Parse(serverURL); err == nil {
		serverURL = parsed.String()
	}

	apiKey := cfg.APIKey
	if apiKey == "" {
		apiKey = "xyz"
	}

	client := typesense.NewClient(
		typesense.WithServer(serverURL),
		typesense.WithAPIKey(apiKey),
	)

	log.Printf("Typesense client initialized: %s", serverURL)
	return client
}
