package search

import (
	"log"
	"net/url"
	"os"

	"github.com/typesense/typesense-go/v3/typesense"
)

// NewTypesenseClient creates a Typesense client from environment variables.
// Reads TYPESENSE_URL (or TYPESENSE_HOST/TYPESENSE_PORT) and TYPESENSE_API_KEY.
func NewTypesenseClient() *typesense.Client {
	var serverURL string

	if u := os.Getenv("TYPESENSE_URL"); u != "" {
		serverURL = u
	} else {
		host := os.Getenv("TYPESENSE_HOST")
		if host == "" {
			host = "localhost"
		}
		port := os.Getenv("TYPESENSE_PORT")
		if port == "" {
			port = "8108"
		}
		protocol := "http"
		if os.Getenv("TYPESENSE_PROTOCOL") == "https" {
			protocol = "https"
		}
		serverURL = protocol + "://" + host + ":" + port
	}

	// Normalize: strip trailing slash
	if parsed, err := url.Parse(serverURL); err == nil {
		serverURL = parsed.String()
	}

	apiKey := os.Getenv("TYPESENSE_API_KEY")
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
