package http

import (
	"strings"

	"github.com/andyathsid/backend/internal/app"
	"github.com/gofiber/fiber/v2"
)

// FirebaseAuth verifies a Firebase ID token and stores the UID in locals.
func FirebaseAuth(identity app.IdentityProvider) func(*fiber.Ctx) error {
	return func(c *fiber.Ctx) error {
		authHeader := c.Get("Authorization")
		if authHeader == "" {
			return writeError(c, app.Unauthenticated("Authorization header is required", nil))
		}

		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenStr == authHeader || tokenStr == "" {
			return writeError(c, app.Unauthenticated("Bearer token is required", nil))
		}

		// Verify the Firebase ID token
		token, err := identity.VerifyIDToken(c.UserContext(), tokenStr)
		if err != nil {
			return writeError(c, app.Unauthenticated("Invalid or expired token", err))
		}

		// Store verified UID in locals for controllers to use
		c.Locals("userID", token.UID)
		return c.Next()
	}
}
