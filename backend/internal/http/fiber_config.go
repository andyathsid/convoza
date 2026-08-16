package http

import (
	"time"

	"github.com/gofiber/fiber/v2"
)

// FiberConfig func for configuration Fiber app.
// See: https://docs.gofiber.io/api/fiber#config
func FiberConfig(readTimeout time.Duration, bodyLimit int) fiber.Config {
	return fiber.Config{
		ReadTimeout: readTimeout,
		BodyLimit:   bodyLimit,
	}
}
