package http

import (
	"context"
	"fmt"
	"strings"

	application "github.com/andyathsid/backend/internal/app"
	"github.com/gofiber/fiber/v2"
	"github.com/meilisearch/meilisearch-go"
)

const (
	maxSearchQueries = 10
	maxSearchHits    = 100
)

// SearchClient is the small subset of Meilisearch used by the browser search
// endpoint. The backend owns its API key; it is never sent to the browser.
type SearchClient interface {
	MultiSearchWithContext(context.Context, *meilisearch.MultiSearchRequest) (*meilisearch.MultiSearchResponse, error)
}

type SearchController struct {
	client SearchClient
}

func NewSearchController(client SearchClient) *SearchController {
	return &SearchController{client: client}
}

// MultiSearch accepts the Instant Meilisearch multi-search payload and applies
// access-control filters that cannot be removed by a browser client.
func (h *SearchController) MultiSearch(c *fiber.Ctx) error {
	if h.client == nil {
		return writeError(c, application.DependencyUnavailable("search is unavailable", nil))
	}
	userID, err := authenticatedUserID(c)
	if err != nil {
		return writeError(c, err)
	}

	request := &meilisearch.MultiSearchRequest{}
	if err := c.BodyParser(request); err != nil {
		return writeError(c, application.InvalidInput("invalid search request", err))
	}
	if err := authorizeSearchRequest(request, userID); err != nil {
		return writeError(c, err)
	}

	response, err := h.client.MultiSearchWithContext(c.UserContext(), request)
	if err != nil {
		return writeError(c, application.DependencyUnavailable("search is unavailable", err))
	}
	return c.JSON(response)
}

func authorizeSearchRequest(request *meilisearch.MultiSearchRequest, userID string) error {
	if len(request.Queries) == 0 {
		return application.InvalidInput("at least one search query is required", nil)
	}
	if len(request.Queries) > maxSearchQueries {
		return application.InvalidInput(fmt.Sprintf("at most %d search queries are allowed", maxSearchQueries), nil)
	}
	if request.Federation != nil {
		return application.InvalidInput("federated search is not supported", nil)
	}

	participantFilter := fmt.Sprintf(`participants = "%s"`, escapeSearchFilterValue(userID))
	for _, query := range request.Queries {
		if query == nil {
			return application.InvalidInput("search query is required", nil)
		}
		switch query.IndexUID {
		case "messages", "chats", "groups":
			query.Filter = combineSearchFilters(participantFilter, query.Filter)
		case "contacts":
			// Contacts are application-wide usernames. Their index exposes only
			// id and username (see the Meilisearch index schema).
		default:
			return application.Forbidden("search index is not allowed", nil)
		}
		if query.Limit > maxSearchHits {
			query.Limit = maxSearchHits
		}
		if query.HitsPerPage != nil && *query.HitsPerPage > maxSearchHits {
			limit := int64(maxSearchHits)
			query.HitsPerPage = &limit
		}
	}
	return nil
}

func combineSearchFilters(required string, requested interface{}) interface{} {
	if requested == nil {
		return required
	}
	if value, ok := requested.(string); ok && strings.TrimSpace(value) == "" {
		return required
	}
	// Meilisearch interprets top-level filter arrays as AND clauses. Keeping the
	// requester's filter as one item preserves nested OR groups while making the
	// authenticated-participant filter mandatory.
	return []interface{}{required, requested}
}

func escapeSearchFilterValue(value string) string {
	return strings.NewReplacer("\\", "\\\\", `"`, `\"`).Replace(value)
}
