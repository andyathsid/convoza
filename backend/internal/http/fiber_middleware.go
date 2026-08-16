package http

import (
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
)

// FiberMiddleware provide Fiber's built-in middlewares.
// See: https://docs.gofiber.io/api/middleware
func FiberMiddleware(a *fiber.App, origins string) {
	a.Use(
		// Add CORS to each route.
		cors.New(cors.Config{
			AllowOrigins:     origins,
			AllowCredentials: true,
			AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
			AllowMethods:     "GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS",
		}),
		// Add simple logger.
		logger.New(),
	)
}
