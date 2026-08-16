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

func TestPublicRoutes(t *testing.T) {
	// Load .env.test file from the root folder
	if err := godotenv.Load("../../.env.test"); err != nil {
		// .env.test may not exist in CI
	}

	// Define services and controllers.
	authService := services.NewAuthService(&fakeUserRepository{}, &firestore.FirestoreClient{}, nil, nil)
	authController := controllers.NewAuthController(authService)

	// Define Fiber app.
	app := fiber.New()

	// Define routes.
	PublicRoutes(app, authController)

	// Define a structure for specifying input and output data of a single test case.
	tests := []struct {
		description   string
		route         string
		method        string
		expectedError bool
		expectedCode  int
	}{
		{
			description:   "sync user without body",
			route:         "/api/v1/auth/sync",
			method:        "POST",
			expectedError: false,
			expectedCode:  400,
		},
		{
			description:   "verify token without header",
			route:         "/api/v1/auth/verify",
			method:        "POST",
			expectedError: false,
			expectedCode:  400,
		},
	}

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
