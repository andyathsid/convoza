package search

import (
	"log"

	"github.com/meilisearch/meilisearch-go"

	"github.com/andyathsid/backend/internal/platform/config"
)

// NewMeiliClient creates a Meilisearch client from MEILI_URL and MEILI_API_KEY.
func NewMeiliClient(cfg config.Search) meilisearch.ServiceManager {
	client := meilisearch.New(cfg.URL, meilisearch.WithAPIKey(cfg.APIKey))
	log.Printf("Meilisearch client initialized: %s", cfg.URL)
	return client
}
