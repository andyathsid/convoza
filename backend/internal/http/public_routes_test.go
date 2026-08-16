package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	application "github.com/andyathsid/backend/internal/app"
	"github.com/gofiber/fiber/v2"
)

func TestPublicAuthRoutesRequireAuthorization(t *testing.T) {
	server := fiber.New()
	auth := application.NewAuthService(&fakeUserRepository{}, fakeProfiles{}, fakeIdentityProvider{}, application.NopSearchIndexer{}, nil)
	PublicRoutes(server, NewAuthController(auth))

	for _, path := range []string{"/api/v1/auth/sync", "/api/v1/auth/verify"} {
		response, err := server.Test(httptest.NewRequest(http.MethodPost, path, nil), -1)
		if err != nil {
			t.Fatalf("request %s: %v", path, err)
		}
		if response.StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s returned %d, want 401", path, response.StatusCode)
		}
		assertErrorBody(t, response, "Authorization header is required")
	}
}

func TestSyncUserPreservesSuccessfulResponseShape(t *testing.T) {
	server := fiber.New()
	identity := fakeIdentityProvider{identity: application.Identity{UID: "alice", Email: "alice@example.test", Name: "Alice"}}
	auth := application.NewAuthService(&fakeUserRepository{}, fakeProfiles{}, identity, application.NopSearchIndexer{}, nil)
	PublicRoutes(server, NewAuthController(auth))

	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/sync", strings.NewReader(`{"username":"Alice"}`))
	request.Header.Set("Authorization", "Bearer valid-token")
	request.Header.Set("Content-Type", "application/json")
	response, err := server.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("sync returned %d", response.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	user, ok := body["user"].(map[string]any)
	if body["error"] != false || !ok || user["id"] != "alice" || user["username"] != "Alice" {
		t.Fatalf("unexpected sync response: %#v", body)
	}
}

func assertErrorBody(t *testing.T, response *http.Response, message string) {
	t.Helper()
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != true || body["msg"] != message {
		t.Fatalf("unexpected error response: %#v", body)
	}
}
