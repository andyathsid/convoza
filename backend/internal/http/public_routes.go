package http

import (
	"github.com/gofiber/fiber/v2"
)

// PublicRoutes func for describe group of public routes.
func PublicRoutes(a *fiber.App, auth *AuthController, allowedOrigins string) {
	route := a.Group("/api/v1")
	originProtected := RequireTrustedOrigin(allowedOrigins)
	route.Post("/auth/session", originProtected, auth.CreateSession)
	route.Get("/auth/session", auth.CurrentSession)
	route.Delete("/auth/session", originProtected, auth.DeleteSession)
}
