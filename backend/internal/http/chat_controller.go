package http

import (
	"context"

	application "github.com/andyathsid/backend/internal/app"
	"github.com/gofiber/fiber/v2"
)

type ChatController struct {
	service *application.ChatService
}

func NewChatController(service *application.ChatService) *ChatController {
	return &ChatController{service: service}
}

func (h *ChatController) CreateChat(c *fiber.Ctx) error {
	userID, err := authenticatedUserID(c)
	if err != nil {
		return writeError(c, err)
	}
	input := &createChatRequest{}
	if err := c.BodyParser(input); err != nil {
		return writeError(c, application.InvalidInput("invalid request body", err))
	}
	chat, err := h.service.CreateChat(c.UserContext(), userID, input.input())
	if err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{"error": false, "chat": chatDTO(*chat)})
}

func (h *ChatController) GetSingleChat(c *fiber.Ctx) error {
	userID, err := authenticatedUserID(c)
	if err != nil {
		return writeError(c, err)
	}
	chat, err := h.service.GetSingleChat(c.UserContext(), c.Params("id"), userID)
	if err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{"error": false, "chat": chatDTO(*chat)})
}

func (h *ChatController) GetAllUsers(c *fiber.Ctx) error {
	userID, err := authenticatedUserID(c)
	if err != nil {
		return writeError(c, err)
	}
	users, err := h.service.GetAllUsers(c.UserContext(), userID)
	if err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{"error": false, "users": usersDTO(users)})
}

func (h *ChatController) SearchUsers(c *fiber.Ctx) error {
	userID, err := authenticatedUserID(c)
	if err != nil {
		return writeError(c, err)
	}
	users, err := h.service.SearchUsers(c.UserContext(), userID, c.Query("q"))
	if err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{"error": false, "users": usersDTO(users)})
}

func (h *ChatController) AddMembers(c *fiber.Ctx) error {
	userID, err := authenticatedUserID(c)
	if err != nil {
		return writeError(c, err)
	}
	input := &addMembersRequest{}
	if err := c.BodyParser(input); err != nil {
		return writeError(c, application.InvalidInput("invalid request body", err))
	}
	if err := h.service.AddMembers(c.UserContext(), c.Params("chatId"), userID, input.UserIDs); err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{"error": false, "msg": "Members added successfully"})
}

func (h *ChatController) RemoveMember(c *fiber.Ctx) error {
	return h.memberAction(c, "Member removed successfully", h.service.RemoveMember)
}

func (h *ChatController) PromoteMember(c *fiber.Ctx) error {
	return h.memberAction(c, "Member promoted successfully", h.service.PromoteMember)
}

func (h *ChatController) DemoteMember(c *fiber.Ctx) error {
	return h.memberAction(c, "Member demoted successfully", h.service.DemoteMember)
}

func (h *ChatController) memberAction(c *fiber.Ctx, successMessage string, action func(context.Context, string, string, string) error) error {
	userID, err := authenticatedUserID(c)
	if err != nil {
		return writeError(c, err)
	}
	if err := action(c.UserContext(), c.Params("chatId"), userID, c.Params("userId")); err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{"error": false, "msg": successMessage})
}

func (h *ChatController) LeaveGroup(c *fiber.Ctx) error {
	userID, err := authenticatedUserID(c)
	if err != nil {
		return writeError(c, err)
	}
	if err := h.service.LeaveGroup(c.UserContext(), c.Params("chatId"), userID); err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{"error": false, "msg": "Left group successfully"})
}

func (h *ChatController) RenameGroup(c *fiber.Ctx) error {
	userID, err := authenticatedUserID(c)
	if err != nil {
		return writeError(c, err)
	}
	input := &struct {
		GroupName string `json:"groupName"`
	}{}
	if err := c.BodyParser(input); err != nil {
		return writeError(c, application.InvalidInput("invalid request body", err))
	}
	if err := h.service.RenameGroup(c.UserContext(), c.Params("chatId"), userID, input.GroupName); err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{"error": false, "msg": "Group renamed successfully"})
}

func (h *ChatController) ReindexUserSearch(c *fiber.Ctx) error {
	h.service.ReindexUserSearch(c.UserContext(), c.Params("userId"))
	return c.JSON(fiber.Map{"error": false, "msg": "reindex triggered"})
}

func (h *ChatController) UpdateGroupAvatar(c *fiber.Ctx) error {
	userID, err := authenticatedUserID(c)
	if err != nil {
		return writeError(c, err)
	}
	avatarHeader, err := c.FormFile("avatar")
	if err != nil {
		return writeError(c, application.InvalidInput("avatar file is required", err))
	}
	avatar, err := openStorageUpload(avatarHeader)
	if err != nil {
		return writeError(c, application.InvalidInput("avatar file could not be opened", err))
	}
	defer avatar.close()
	object, err := h.service.UpdateGroupAvatarUpload(c.UserContext(), c.Params("chatId"), userID, avatar.upload)
	if err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{"error": false, "avatarURL": object.DownloadURL, "avatarPath": object.Path})
}

func authenticatedUserID(c *fiber.Ctx) (string, error) {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return "", application.Unauthenticated("Unauthorized", nil)
	}
	return userID, nil
}
