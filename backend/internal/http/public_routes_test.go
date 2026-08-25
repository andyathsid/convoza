package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	application "github.com/andyathsid/backend/internal/app"
	"github.com/gofiber/fiber/v2"
)

const testSessionCookieName = "convoza_session"

func testSessionCookieConfig() SessionCookieConfig {
	return SessionCookieConfig{Name: testSessionCookieName, MaxAge: 12 * 24 * time.Hour}
}

func TestCreateSessionRequiresAuthorization(t *testing.T) {
	server := fiber.New()
	auth := application.NewAuthService(&fakeUserRepository{}, fakeProfiles{}, fakeIdentityProvider{}, application.NopSearchIndexer{}, nil)
	PublicRoutes(server, NewAuthController(auth, testSessionCookieConfig()), "https://app.example.test")

	response, err := server.Test(httptest.NewRequest(http.MethodPost, "/api/v1/auth/session", nil), -1)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("create session returned %d, want 401", response.StatusCode)
	}
	assertErrorBody(t, response, "Authorization header is required")
}

func TestCreateSessionSetsHostOnlyHTTPOnlyCookie(t *testing.T) {
	server := fiber.New()
	identity := fakeIdentityProvider{identity: application.Identity{UID: "alice", Email: "alice@example.test", Name: "Alice"}}
	auth := application.NewAuthService(&fakeUserRepository{}, fakeProfiles{}, identity, application.NopSearchIndexer{}, nil)
	PublicRoutes(server, NewAuthController(auth, testSessionCookieConfig()), "https://app.example.test")

	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/session", strings.NewReader(`{"username":"Alice"}`))
	request.Header.Set("Authorization", "Bearer valid-token")
	request.Header.Set("Content-Type", "application/json")
	response, err := server.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("create session returned %d", response.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	user, ok := body["user"].(map[string]any)
	if body["error"] != false || !ok || user["id"] != "alice" || user["username"] != "Alice" {
		t.Fatalf("unexpected sync response: %#v", body)
	}
	cookie := response.Header.Get("Set-Cookie")
	if !strings.Contains(cookie, testSessionCookieName+"=session-cookie") || !strings.Contains(cookie, "HttpOnly") || strings.Contains(cookie, "Domain=") {
		t.Fatalf("unexpected session cookie: %q", cookie)
	}
}

func TestDeleteSessionRejectsUntrustedOrigin(t *testing.T) {
	server := fiber.New()
	auth := application.NewAuthService(&fakeUserRepository{}, fakeProfiles{}, fakeIdentityProvider{}, application.NopSearchIndexer{}, nil)
	PublicRoutes(server, NewAuthController(auth, testSessionCookieConfig()), "https://app.example.test")
	request := httptest.NewRequest(http.MethodDelete, "/api/v1/auth/session", nil)
	request.Header.Set("Origin", "https://attacker.example.test")
	response, err := server.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("delete session returned %d, want 403", response.StatusCode)
	}
	assertErrorBody(t, response, "untrusted request origin")
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
