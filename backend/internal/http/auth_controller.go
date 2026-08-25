package http

import (
	"strings"
	"time"

	services "github.com/andyathsid/backend/internal/app"
	"github.com/gofiber/fiber/v2"
)

type AuthController struct {
	service       *services.AuthService
	sessionCookie SessionCookieConfig
}

type SessionCookieConfig struct {
	Name   string
	MaxAge time.Duration
	Secure bool
}

func NewAuthController(service *services.AuthService, sessionCookie SessionCookieConfig) *AuthController {
	return &AuthController{service: service, sessionCookie: sessionCookie}
}

// CreateSession exchanges a Firebase ID token for a host-only HTTP-only API
// session cookie. The ID token is used only for this exchange.
func (h *AuthController) CreateSession(c *fiber.Ctx) error {
	idToken, err := bearerToken(c)
	if err != nil {
		return writeError(c, err)
	}
	input := &syncUserRequest{}
	if len(c.Body()) > 0 {
		if err := c.BodyParser(input); err != nil {
			return writeError(c, services.InvalidInput("invalid request body", err))
		}
	}
	var opts *services.AuthSyncOpts
	if input.Username != "" || input.Avatar != "" {
		opts = &services.AuthSyncOpts{Username: input.Username, Avatar: input.Avatar, AvatarPath: input.AvatarPath}
	}
	user, sessionCookie, err := h.service.CreateSession(c.UserContext(), idToken, opts, h.sessionCookie.MaxAge)
	if err != nil {
		return writeError(c, err)
	}
	c.Cookie(&fiber.Cookie{
		Name:     h.sessionCookie.Name,
		Value:    sessionCookie,
		Path:     "/",
		HTTPOnly: true,
		Secure:   h.sessionCookie.Secure,
		SameSite: "Lax",
		MaxAge:   int(h.sessionCookie.MaxAge.Seconds()),
	})
	return c.JSON(fiber.Map{"error": false, "user": userDTO(*user)})
}

// CurrentSession restores the application user from the API session cookie.
func (h *AuthController) CurrentSession(c *fiber.Ctx) error {
	cookie := c.Cookies(h.sessionCookie.Name)
	if cookie == "" {
		return writeError(c, services.Unauthenticated("session cookie is required", nil))
	}
	user, err := h.service.VerifySession(c.UserContext(), cookie)
	if err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{"error": false, "user": userDTO(*user)})
}

// DeleteSession clears the browser's API session cookie. It deliberately does
// not revoke Firebase refresh tokens, so signing out on one device does not
// terminate the user's other Firebase sessions.
func (h *AuthController) DeleteSession(c *fiber.Ctx) error {
	c.Cookie(&fiber.Cookie{
		Name:     h.sessionCookie.Name,
		Path:     "/",
		HTTPOnly: true,
		Secure:   h.sessionCookie.Secure,
		SameSite: "Lax",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
	})
	return c.JSON(fiber.Map{"error": false})
}

func bearerToken(c *fiber.Ctx) (string, error) {
	authHeader := c.Get("Authorization")
	if authHeader == "" {
		return "", services.Unauthenticated("Authorization header is required", nil)
	}
	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token == authHeader || token == "" {
		return "", services.Unauthenticated("Bearer token is required", nil)
	}
	return token, nil
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
