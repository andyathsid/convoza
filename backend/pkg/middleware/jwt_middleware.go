package middleware

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	firebaseUtil "github.com/andyathsid/backend/platform/firebase"
)

// FirebaseAuth verifies a Firebase ID token and stores the UID in locals.
func FirebaseAuth() func(*fiber.Ctx) error {
	return func(c *fiber.Ctx) error {
		authHeader := c.Get("Authorization")
		if authHeader == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": true, "msg": "Authorization header is required",
			})
		}

		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenStr == authHeader {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": true, "msg": "Bearer token is required",
			})
		}

		// Verify the Firebase ID token
		token, err := firebaseUtil.Auth.VerifyIDToken(c.Context(), tokenStr)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": true, "msg": "Invalid or expired token",
			})
		}

		// Store verified UID in locals for controllers to use
		c.Locals("userID", token.UID)
		return c.Next()
	}
}
