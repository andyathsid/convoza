package http

import (
	"strings"

	"github.com/andyathsid/backend/internal/app"
	"github.com/gofiber/fiber/v2"
)

// RequireTrustedOrigin blocks cross-site state changes made with an API session
// cookie. Requests without an Origin header are allowed for non-browser clients.
func RequireTrustedOrigin(allowedOrigins string) func(*fiber.Ctx) error {
	allowed := make(map[string]struct{})
	for _, origin := range strings.Split(allowedOrigins, ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			allowed[origin] = struct{}{}
		}
	}

	return func(c *fiber.Ctx) error {
		switch c.Method() {
		case fiber.MethodGet, fiber.MethodHead, fiber.MethodOptions:
			return c.Next()
		}
		origin := c.Get(fiber.HeaderOrigin)
		if origin == "" {
			return c.Next()
		}
		if _, ok := allowed[origin]; !ok {
			return writeError(c, app.Forbidden("untrusted request origin", nil))
		}
		return c.Next()
	}
}
