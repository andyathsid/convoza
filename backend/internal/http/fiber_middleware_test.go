package http

import (
	stdhttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestFiberMiddlewareAllowsInstantMeilisearchPreflightHeader(t *testing.T) {
	server := fiber.New()
	FiberMiddleware(server, "https://app.example.test")
	server.Post("/api/v1/search/multi-search", func(*fiber.Ctx) error { return nil })

	request := httptest.NewRequest(stdhttp.MethodOptions, "/api/v1/search/multi-search", nil)
	request.Header.Set(fiber.HeaderOrigin, "https://app.example.test")
	request.Header.Set(fiber.HeaderAccessControlRequestMethod, stdhttp.MethodPost)
	request.Header.Set(fiber.HeaderAccessControlRequestHeaders, "content-type, x-meilisearch-client")
	response, err := server.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusNoContent {
		t.Fatalf("preflight returned %d", response.StatusCode)
	}
	if !strings.Contains(strings.ToLower(response.Header.Get(fiber.HeaderAccessControlAllowHeaders)), "x-meilisearch-client") {
		t.Fatalf("preflight did not allow X-Meilisearch-Client: %q", response.Header.Get(fiber.HeaderAccessControlAllowHeaders))
	}
}
