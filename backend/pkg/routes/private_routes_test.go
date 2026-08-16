package routes

import (
	"net/http/httptest"
	"testing"

	"github.com/andyathsid/backend/app/controllers"
	"github.com/andyathsid/backend/app/services"
	"github.com/andyathsid/backend/platform/firestore"
	"github.com/gofiber/fiber/v2"
	"github.com/joho/godotenv"
	"github.com/stretchr/testify/assert"
)

func TestPrivateRoutes(t *testing.T) {
	// Load .env.test file from the root folder.
	if err := godotenv.Load("../../.env.test"); err != nil {
		// .env.test may not exist in CI
	}

	// Define a structure for specifying input and output data of a single test case.
	tests := []struct {
		description   string
		route         string
		method        string
		expectedError bool
		expectedCode  int
	}{
		{
			description:   "send message without auth",
			route:         "/api/v1/message/send",
			method:        "POST",
			expectedError: false,
			expectedCode:  401,
		},
		{
			description:   "get users without auth",
			route:         "/api/v1/users",
			method:        "GET",
			expectedError: false,
			expectedCode:  401,
		},
	}

	// Define services and controllers.
	authService := services.NewAuthService(&fakeUserRepository{}, &firestore.FirestoreClient{}, nil, nil)
	chatService := services.NewChatService(&fakeUserRepository{}, &firestore.FirestoreClient{}, nil, nil, nil)
	messageService := services.NewMessageService(&fakeUserRepository{}, &firestore.FirestoreClient{}, nil, nil)

	authController := controllers.NewAuthController(authService)
	chatController := controllers.NewChatController(chatService)
	messageController := controllers.NewMessageController(messageService)

	// Define a new Fiber app.
	app := fiber.New()

	// Define routes.
	PrivateRoutes(app, authController, chatController, messageController)

	// Iterate through test single test cases
	for _, test := range tests {
		req := httptest.NewRequest(test.method, test.route, nil)
		req.Header.Set("Content-Type", "application/json")

		resp, err := app.Test(req, -1)

		assert.Equalf(t, test.expectedError, err != nil, test.description)

		if test.expectedError {
			continue
		}

		assert.Equalf(t, test.expectedCode, resp.StatusCode, test.description)
	}
}
