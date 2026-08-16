package routes

import (
	"github.com/andyathsid/backend/app/controllers"
	"github.com/gofiber/fiber/v2"
)

// PublicRoutes func for describe group of public routes.
func PublicRoutes(a *fiber.App, auth *controllers.AuthController) {
	route := a.Group("/api/v1")
	route.Post("/auth/sync", auth.SyncUser)
	route.Post("/auth/verify", auth.VerifyUser)
}
