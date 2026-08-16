package http

import (
	"github.com/gofiber/fiber/v2"
)

// PublicRoutes func for describe group of public routes.
func PublicRoutes(a *fiber.App, auth *AuthController) {
	route := a.Group("/api/v1")
	route.Post("/auth/sync", auth.SyncUser)
	route.Post("/auth/verify", auth.VerifyUser)
}
