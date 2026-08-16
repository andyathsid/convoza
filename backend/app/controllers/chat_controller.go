package controllers

import (
	"context"

	"github.com/andyathsid/backend/app/models"
	"github.com/andyathsid/backend/app/services"
	"github.com/gofiber/fiber/v2"
)

type ChatController struct {
	service *services.ChatService
}

func NewChatController(service *services.ChatService) *ChatController {
	return &ChatController{service: service}
}

func (h *ChatController) CreateChat(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}

	input := &models.CreateChatInput{}
	if err := c.BodyParser(input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	chat, err := h.service.CreateChat(context.Background(), userID, input)
	if err != nil {
		if svcErr, ok := err.(*services.ServiceError); ok {
			return c.Status(svcErr.Status).JSON(fiber.Map{"error": true, "msg": svcErr.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	return c.JSON(fiber.Map{"error": false, "chat": chat})
}

func (h *ChatController) GetSingleChat(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}

	chatID := c.Params("id")

	chat, err := h.service.GetSingleChat(context.Background(), chatID, userID)
	if err != nil {
		if svcErr, ok := err.(*services.ServiceError); ok {
			return c.Status(svcErr.Status).JSON(fiber.Map{"error": true, "msg": svcErr.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	return c.JSON(fiber.Map{"error": false, "chat": chat})
}

func (h *ChatController) GetAllUsers(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}

	users, err := h.service.GetAllUsers(context.Background(), userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	return c.JSON(fiber.Map{"error": false, "users": users})
}

func (h *ChatController) SearchUsers(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}

	query := c.Query("q", "")
	if query == "" {
		return c.JSON(fiber.Map{"error": false, "users": []models.User{}})
	}

	users, err := h.service.SearchUsers(context.Background(), userID, query)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	return c.JSON(fiber.Map{"error": false, "users": users})
}

// AddMembers adds new members to a group chat.
func (h *ChatController) AddMembers(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}

	chatID := c.Params("chatId")
	input := &models.AddMembersInput{}
	if err := c.BodyParser(input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	if err := h.service.AddMembers(context.Background(), chatID, userID, input.UserIds); err != nil {
		if svcErr, ok := err.(*services.ServiceError); ok {
			return c.Status(svcErr.Status).JSON(fiber.Map{"error": true, "msg": svcErr.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	return c.JSON(fiber.Map{"error": false, "msg": "Members added successfully"})
}

// RemoveMember removes a member from a group chat.
func (h *ChatController) RemoveMember(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}

	chatID := c.Params("chatId")
	targetID := c.Params("userId")

	if err := h.service.RemoveMember(context.Background(), chatID, userID, targetID); err != nil {
		if svcErr, ok := err.(*services.ServiceError); ok {
			return c.Status(svcErr.Status).JSON(fiber.Map{"error": true, "msg": svcErr.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	return c.JSON(fiber.Map{"error": false, "msg": "Member removed successfully"})
}

// PromoteMember promotes a member to admin.
func (h *ChatController) PromoteMember(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}

	chatID := c.Params("chatId")
	targetID := c.Params("userId")

	if err := h.service.PromoteMember(context.Background(), chatID, userID, targetID); err != nil {
		if svcErr, ok := err.(*services.ServiceError); ok {
			return c.Status(svcErr.Status).JSON(fiber.Map{"error": true, "msg": svcErr.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	return c.JSON(fiber.Map{"error": false, "msg": "Member promoted successfully"})
}

// DemoteMember demotes an admin to a regular member.
func (h *ChatController) DemoteMember(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}

	chatID := c.Params("chatId")
	targetID := c.Params("userId")

	if err := h.service.DemoteMember(context.Background(), chatID, userID, targetID); err != nil {
		if svcErr, ok := err.(*services.ServiceError); ok {
			return c.Status(svcErr.Status).JSON(fiber.Map{"error": true, "msg": svcErr.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	return c.JSON(fiber.Map{"error": false, "msg": "Member demoted successfully"})
}

// LeaveGroup removes the current user from a group chat.
func (h *ChatController) LeaveGroup(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}

	chatID := c.Params("chatId")

	if err := h.service.LeaveGroup(context.Background(), chatID, userID); err != nil {
		if svcErr, ok := err.(*services.ServiceError); ok {
			return c.Status(svcErr.Status).JSON(fiber.Map{"error": true, "msg": svcErr.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	return c.JSON(fiber.Map{"error": false, "msg": "Left group successfully"})
}

// RenameGroup updates a group's name.
func (h *ChatController) RenameGroup(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}

	chatID := c.Params("chatId")

	input := &struct {
		GroupName string `json:"groupName"`
	}{}
	if err := c.BodyParser(input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	if err := h.service.RenameGroup(context.Background(), chatID, userID, input.GroupName); err != nil {
		if svcErr, ok := err.(*services.ServiceError); ok {
			return c.Status(svcErr.Status).JSON(fiber.Map{"error": true, "msg": svcErr.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	return c.JSON(fiber.Map{"error": false, "msg": "Group renamed successfully"})
}

// ReindexUserSearch refreshes indexed profile fields from the canonical Firestore document.
func (h *ChatController) ReindexUserSearch(c *fiber.Ctx) error {
	userID := c.Params("userId")
	h.service.ReindexUserSearch(context.Background(), userID)
	return c.JSON(fiber.Map{"error": false, "msg": "reindex triggered"})
}

// UpdateGroupAvatar updates a group's avatar URL.
func (h *ChatController) UpdateGroupAvatar(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}

	chatID := c.Params("chatId")

	avatarHeader, err := c.FormFile("avatar")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": "avatar file is required"})
	}
	avatar, err := openStorageUpload(avatarHeader)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": "avatar file could not be opened"})
	}
	defer avatar.close()
	object, err := h.service.UpdateGroupAvatarUpload(c.UserContext(), chatID, userID, avatar.upload)
	if err != nil {
		if serviceError, ok := err.(*services.ServiceError); ok {
			return c.Status(serviceError.Status).JSON(fiber.Map{"error": true, "msg": serviceError.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}
	return c.JSON(fiber.Map{"error": false, "avatarURL": object.DownloadURL, "avatarPath": object.Path})
}
