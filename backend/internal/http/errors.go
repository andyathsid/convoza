package http

import (
	"errors"
	"log"

	application "github.com/andyathsid/backend/internal/app"
	"github.com/gofiber/fiber/v2"
)

func writeError(c *fiber.Ctx, err error) error {
	status := fiber.StatusInternalServerError
	message := "Internal server error"
	var applicationError *application.ServiceError
	if errors.As(err, &applicationError) {
		status = statusForErrorCode(applicationError.Code)
		if applicationError.Message != "" {
			message = applicationError.Message
		}
		if applicationError.Err != nil {
			log.Printf("request failed method=%s path=%s code=%s cause=%v", c.Method(), c.Path(), applicationError.Code, applicationError.Err)
		}
	} else if err != nil {
		log.Printf("request failed method=%s path=%s cause=%v", c.Method(), c.Path(), err)
	}
	return c.Status(status).JSON(fiber.Map{"error": true, "msg": message})
}

func statusForErrorCode(code application.ErrorCode) int {
	switch code {
	case application.CodeInvalidInput:
		return fiber.StatusBadRequest
	case application.CodeUnauthenticated:
		return fiber.StatusUnauthorized
	case application.CodeForbidden:
		return fiber.StatusForbidden
	case application.CodeNotFound:
		return fiber.StatusNotFound
	case application.CodeConflict:
		return fiber.StatusConflict
	case application.CodePayloadTooLarge:
		return fiber.StatusRequestEntityTooLarge
	case application.CodeDependencyUnavailable:
		return fiber.StatusBadGateway
	default:
		return fiber.StatusInternalServerError
	}
}
