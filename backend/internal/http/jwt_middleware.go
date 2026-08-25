package http

import (
	"github.com/andyathsid/backend/internal/app"
	"github.com/gofiber/fiber/v2"
)

// FirebaseSessionAuth verifies the backend's Firebase session cookie and stores
// the UID in locals. Firebase ID tokens are accepted only by session creation.
func FirebaseSessionAuth(identity app.IdentityProvider, cookieName string) func(*fiber.Ctx) error {
	return func(c *fiber.Ctx) error {
		sessionCookie := c.Cookies(cookieName)
		if sessionCookie == "" {
			return writeError(c, app.Unauthenticated("session cookie is required", nil))
		}

		token, err := identity.VerifySessionCookie(c.UserContext(), sessionCookie)
		if err != nil {
			return writeError(c, app.Unauthenticated("invalid or expired session", err))
		}

		// Store verified UID in locals for controllers to use
		c.Locals("userID", token.UID)
		return c.Next()
	}
}
