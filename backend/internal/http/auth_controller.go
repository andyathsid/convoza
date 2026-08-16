package http

import (
	"strings"

	services "github.com/andyathsid/backend/internal/app"
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
		return writeError(c, services.Unauthenticated("Authorization header is required", nil))
	}

	firebaseToken := strings.TrimPrefix(authHeader, "Bearer ")
	if firebaseToken == authHeader || firebaseToken == "" {
		return writeError(c, services.Unauthenticated("Bearer token is required", nil))
	}

	input := &syncUserRequest{}
	if len(c.Body()) > 0 {
		if err := c.BodyParser(input); err != nil {
			return writeError(c, services.InvalidInput("invalid request body", err))
		}
	}

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
	user, err := h.service.VerifyAndSyncUser(c.UserContext(), firebaseToken, opts)
	if err != nil {
		return writeError(c, err)
	}

	return c.JSON(fiber.Map{
		"error": false,
		"user":  userDTO(*user),
	})
}

// VerifyUser verifies a Firebase token and returns the user (for session restore on refresh).
func (h *AuthController) VerifyUser(c *fiber.Ctx) error {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return writeError(c, services.Unauthenticated("Authorization header is required", nil))
	}

	firebaseToken := strings.TrimPrefix(authHeader, "Bearer ")
	if firebaseToken == authHeader || firebaseToken == "" {
		return writeError(c, services.Unauthenticated("Bearer token is required", nil))
	}

	user, err := h.service.VerifyAndSyncUser(c.UserContext(), firebaseToken, nil)
	if err != nil {
		return writeError(c, err)
	}

	return c.JSON(fiber.Map{
		"error": false,
		"user":  userDTO(*user),
	})
}

func (h *AuthController) UpdateAvatar(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return writeError(c, services.Unauthenticated("Unauthorized", nil))
	}
	avatarHeader, err := c.FormFile("avatar")
	if err != nil {
		return writeError(c, services.InvalidInput("avatar file is required", err))
	}
	avatar, err := openStorageUpload(avatarHeader)
	if err != nil {
		return writeError(c, services.InvalidInput("avatar file could not be opened", err))
	}
	defer avatar.close()
	user, object, err := h.service.UpdateUserAvatar(c.UserContext(), userID, avatar.upload)
	if err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{"error": false, "user": userDTO(*user), "avatarURL": object.DownloadURL, "avatarPath": object.Path})
}
