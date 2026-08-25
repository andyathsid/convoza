package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	application "github.com/andyathsid/backend/internal/app"
	"github.com/andyathsid/backend/internal/domain"
	"github.com/gofiber/fiber/v2"
	"github.com/meilisearch/meilisearch-go"
)

func TestPrivateRoutesAreRegisteredAndAuthenticated(t *testing.T) {
	server, _, _ := privateTestServer(&fakeUserRepository{}, &fakeMessageRepository{}, &fakeSearchIndexer{})
	required := map[string]bool{
		"POST /api/v1/chat/create":                          false,
		"GET /api/v1/chat/:id":                              false,
		"POST /api/v1/chat/:chatId/members":                 false,
		"POST /api/v1/chat/:chatId/members/:userId/remove":  false,
		"POST /api/v1/chat/:chatId/members/:userId/promote": false,
		"POST /api/v1/chat/:chatId/members/:userId/demote":  false,
		"POST /api/v1/chat/:chatId/leave":                   false,
		"POST /api/v1/chat/:chatId/rename":                  false,
		"POST /api/v1/chat/:chatId/avatar":                  false,
		"POST /api/v1/message/send":                         false,
		"POST /api/v1/message/deliver":                      false,
		"POST /api/v1/message/read":                         false,
		"DELETE /api/v1/chat/:chatId/message/:messageId":    false,
		"POST /api/v1/search/multi-search":                  false,
		"POST /api/v1/users/avatar":                         false,
	}
	for _, route := range server.GetRoutes() {
		key := route.Method + " " + route.Path
		if _, ok := required[key]; ok {
			required[key] = true
		}
	}
	for route, found := range required {
		if !found {
			t.Errorf("missing route %s", route)
		}
	}

	response, err := server.Test(httptest.NewRequest(http.MethodPost, "/api/v1/message/send", nil), -1)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated private route returned %d", response.StatusCode)
	}
}

func TestMultiSearchRestrictsPrivateIndexesToAuthenticatedParticipant(t *testing.T) {
	var received *meilisearch.MultiSearchRequest
	search := &fakeSearchClient{multiSearch: func(_ context.Context, request *meilisearch.MultiSearchRequest) (*meilisearch.MultiSearchResponse, error) {
		received = request
		return &meilisearch.MultiSearchResponse{}, nil
	}}
	server, _, _ := privateTestServerWithSearch(&fakeUserRepository{}, &fakeMessageRepository{}, &fakeSearchIndexer{}, search)
	request := authenticatedRequest(http.MethodPost, "/api/v1/search/multi-search", strings.NewReader(`{"queries":[{"indexUid":"messages","q":"hello","filter":"chatId = \"chat-a\""},{"indexUid":"contacts","q":"bob"}]}`))
	request.Header.Set("Content-Type", "application/json")
	response, err := server.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("search returned %d", response.StatusCode)
	}
	if received == nil || len(received.Queries) != 2 {
		t.Fatalf("unexpected search request: %#v", received)
	}
	filters, ok := received.Queries[0].Filter.([]interface{})
	if !ok || len(filters) != 2 || filters[0] != `participants = "alice"` || filters[1] != `chatId = "chat-a"` {
		t.Fatalf("private-index filters were not restricted: %#v", received.Queries[0].Filter)
	}
	if received.Queries[1].Filter != nil {
		t.Fatalf("contacts filter changed unexpectedly: %#v", received.Queries[1].Filter)
	}
}

func TestMultiSearchRejectsDisallowedIndexes(t *testing.T) {
	search := &fakeSearchClient{multiSearch: func(context.Context, *meilisearch.MultiSearchRequest) (*meilisearch.MultiSearchResponse, error) {
		return nil, errors.New("search client should not be called")
	}}
	server, _, _ := privateTestServerWithSearch(&fakeUserRepository{}, &fakeMessageRepository{}, &fakeSearchIndexer{}, search)
	request := authenticatedRequest(http.MethodPost, "/api/v1/search/multi-search", strings.NewReader(`{"queries":[{"indexUid":"private-admin","q":"hello"}]}`))
	request.Header.Set("Content-Type", "application/json")
	response, err := server.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("disallowed index returned %d", response.StatusCode)
	}
}

func TestSendMessagePreservesMessageIDResponse(t *testing.T) {
	users := &fakeUserRepository{getByID: func(_ context.Context, id string) (domain.User, error) {
		return domain.User{ID: id, Username: "Alice"}, nil
	}}
	messages := &fakeMessageRepository{participant: true}
	server, _, _ := privateTestServer(users, messages, &fakeSearchIndexer{})
	request := authenticatedRequest(http.MethodPost, "/api/v1/message/send", strings.NewReader(`{"chatId":"chat-a","content":"hello"}`))
	request.Header.Set("Content-Type", "application/json")
	response, err := server.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("send returned %d", response.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != false || body["message_id"] == "" {
		t.Fatalf("unexpected send response: %#v", body)
	}
}

func TestSendMultipartMediaPreservesMediaResponse(t *testing.T) {
	users := &fakeUserRepository{getByID: func(_ context.Context, id string) (domain.User, error) {
		return domain.User{ID: id, Username: "Alice"}, nil
	}}
	messages := &fakeMessageRepository{participant: true}
	server, _, _ := privateTestServer(users, messages, &fakeSearchIndexer{})

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("chatId", "chat-a")
	_ = writer.WriteField("mediaType", "image")
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="media"; filename="image.jpg"`)
	header.Set("Content-Type", "image/jpeg")
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte("image"))
	_ = writer.Close()

	request := authenticatedRequest(http.MethodPost, "/api/v1/message/send", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := server.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("multipart send returned %d", response.StatusCode)
	}
	var responseBody map[string]any
	if err := json.NewDecoder(response.Body).Decode(&responseBody); err != nil {
		t.Fatal(err)
	}
	if responseBody["message_id"] == "" || responseBody["mediaURL"] != "https://example.test/media" {
		t.Fatalf("unexpected multipart response: %#v", responseBody)
	}
}

func TestMarkReadPreservesClearedUnreadResponse(t *testing.T) {
	messages := &fakeMessageRepository{participant: true}
	server, _, _ := privateTestServer(&fakeUserRepository{}, messages, &fakeSearchIndexer{})
	request := authenticatedRequest(http.MethodPost, "/api/v1/message/read", strings.NewReader(`{"chatId":"chat-a","messageIds":["message-a"],"readThroughMessageId":"message-a"}`))
	request.Header.Set("Content-Type", "application/json")
	response, err := server.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("read receipt returned %d", response.StatusCode)
	}
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != false || body["clearedUnread"] != true {
		t.Fatalf("unexpected read receipt response: %#v", body)
	}
}

func privateTestServer(users domain.UserRepository, messages domain.MessageRepository, search application.SearchIndexer) (*fiber.App, *application.ChatService, *application.MessageService) {
	return privateTestServerWithSearch(users, messages, search, &fakeSearchClient{})
}

func privateTestServerWithSearch(users domain.UserRepository, messages domain.MessageRepository, search application.SearchIndexer, searchClient SearchClient) (*fiber.App, *application.ChatService, *application.MessageService) {
	identity := fakeIdentityProvider{identity: application.Identity{UID: "alice", Email: "alice@example.test", Name: "Alice"}}
	authService := application.NewAuthService(users, fakeProfiles{}, identity, search, fakeObjectStore{})
	chatService := application.NewChatService(users, nil, search, nil, fakeObjectStore{})
	messageService := application.NewMessageService(users, messages, search, fakeObjectStore{})
	server := fiber.New()
	PrivateRoutes(server, NewAuthController(authService, testSessionCookieConfig()), NewChatController(chatService), NewMessageController(messageService), NewSearchController(searchClient), identity, testSessionCookieName, "https://app.example.test")
	return server, chatService, messageService
}

type fakeSearchClient struct {
	multiSearch func(context.Context, *meilisearch.MultiSearchRequest) (*meilisearch.MultiSearchResponse, error)
}

func (f *fakeSearchClient) MultiSearchWithContext(ctx context.Context, request *meilisearch.MultiSearchRequest) (*meilisearch.MultiSearchResponse, error) {
	if f.multiSearch != nil {
		return f.multiSearch(ctx, request)
	}
	return &meilisearch.MultiSearchResponse{}, nil
}

func authenticatedRequest(method, path string, body io.Reader) *http.Request {
	request := httptest.NewRequest(method, path, body)
	request.Header.Set("Cookie", testSessionCookieName+"=session-cookie")
	return request
}
