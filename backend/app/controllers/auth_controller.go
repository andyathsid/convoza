package controllers

import (
	"context"
	"strings"

	"github.com/andyathsid/backend/app/models"
	"github.com/andyathsid/backend/app/services"
	"github.com/gofiber/fiber/v2"
)

type AuthController struct {
	service *services.AuthService
}

func NewAuthController(service *services.AuthService) *AuthController {
	return &AuthController{service: service}
}

// SyncUser syncs Firebase user to PostgreSQL.
func (h *AuthController) SyncUser(c *fiber.Ctx) error {
	// Get Firebase token from Authorization header
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true,
			"msg":   "Authorization header is required",
		})
	}

	firebaseToken := strings.TrimPrefix(authHeader, "Bearer ")

	input := &models.SyncUserRequest{}
	_ = c.BodyParser(input) // parse error is ignored; fields default to empty

	// Build optional sync opts from frontend-provided fields
	var opts *services.AuthSyncOpts
	if input.Username != "" || input.Avatar != "" || input.Email != "" {
		opts = &services.AuthSyncOpts{
			Username:   input.Username,
			Avatar:     input.Avatar,
			AvatarPath: input.AvatarPath,
			Email:      input.Email,
		}
	}

	// Verify Firebase token and sync user
	user, err := h.service.VerifyAndSyncUser(context.Background(), firebaseToken, opts)
	if err != nil {
		if svcErr, ok := err.(*services.ServiceError); ok {
			return c.Status(svcErr.Status).JSON(fiber.Map{
				"error": true,
				"msg":   svcErr.Message,
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true,
			"msg":   err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"error": false,
		"user":  user,
	})
}

// VerifyUser verifies a Firebase token and returns the user (for session restore on refresh).
func (h *AuthController) VerifyUser(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": true,
			"msg":   "Authorization header is required",
		})
	}

	firebaseToken := strings.TrimPrefix(authHeader, "Bearer ")

	user, err := h.service.VerifyAndSyncUser(context.Background(), firebaseToken, nil)
	if err != nil {
		if svcErr, ok := err.(*services.ServiceError); ok {
			return c.Status(svcErr.Status).JSON(fiber.Map{
				"error": true,
				"msg":   svcErr.Message,
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": true,
			"msg":   err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"error": false,
		"user":  user,
	})
}

func (h *AuthController) UpdateAvatar(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}
	avatarHeader, err := c.FormFile("avatar")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": "avatar file is required"})
	}
	avatar, err := openStorageUpload(avatarHeader)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": "avatar file could not be opened"})
	}
	defer avatar.close()
	user, object, err := h.service.UpdateUserAvatar(c.UserContext(), userID, avatar.upload)
	if err != nil {
		if serviceError, ok := err.(*services.ServiceError); ok {
			return c.Status(serviceError.Status).JSON(fiber.Map{"error": true, "msg": serviceError.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}
	return c.JSON(fiber.Map{"error": false, "user": user, "avatarURL": object.DownloadURL, "avatarPath": object.Path})
}
