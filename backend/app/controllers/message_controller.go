package controllers

import (
	"context"
	"mime/multipart"
	"strconv"
	"strings"

	"github.com/andyathsid/backend/app/models"
	"github.com/andyathsid/backend/app/services"
	"github.com/gofiber/fiber/v2"
)

type MessageController struct {
	service *services.MessageService
}

func NewMessageController(service *services.MessageService) *MessageController {
	return &MessageController{service: service}
}

func (h *MessageController) SendMessage(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}
	if strings.HasPrefix(c.Get("Content-Type"), "multipart/form-data") {
		return h.sendMediaMessage(c, userID)
	}

	input := &models.SendMessageRequest{}
	if err := c.BodyParser(input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	msgID, err := h.service.SendMessage(context.Background(), input.ChatID, userID, input)
	if err != nil {
		if svcErr, ok := err.(*services.ServiceError); ok {
			return c.Status(svcErr.Status).JSON(fiber.Map{"error": true, "msg": svcErr.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	return c.JSON(fiber.Map{"error": false, "message_id": msgID})
}

func (h *MessageController) sendMediaMessage(c *fiber.Ctx, userID string) error {
	mediaHeader, err := c.FormFile("media")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": "media file is required"})
	}
	media, err := openStorageUpload(mediaHeader)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": "media file could not be opened"})
	}
	defer media.close()
	var thumbnail *openedStorageUpload
	if thumbnailHeader, formErr := c.FormFile("thumbnail"); formErr == nil {
		thumbnail, err = openStorageUpload(thumbnailHeader)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": "thumbnail file could not be opened"})
		}
		defer thumbnail.close()
	}
	input := &models.SendMessageRequest{ChatID: c.FormValue("chatId"), Content: c.FormValue("content"), MediaType: c.FormValue("mediaType"), DocumentName: c.FormValue("documentName"), GroupID: c.FormValue("groupId"), ReplyToID: c.FormValue("replyToId")}
	input.MediaWidth, _ = strconv.Atoi(c.FormValue("mediaWidth"))
	input.MediaHeight, _ = strconv.Atoi(c.FormValue("mediaHeight"))
	input.GroupIndex, _ = strconv.Atoi(c.FormValue("groupIndex"))
	if input.ChatID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": "chatId is required"})
	}
	var thumbnailUpload *services.StorageUpload
	if thumbnail != nil {
		thumbnailUpload = &thumbnail.upload
	}
	message, err := h.service.SendMediaMessage(c.UserContext(), input.ChatID, userID, input, media.upload, thumbnailUpload)
	if err != nil {
		if serviceError, ok := err.(*services.ServiceError); ok {
			return c.Status(serviceError.Status).JSON(fiber.Map{"error": true, "msg": serviceError.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}
	return c.JSON(fiber.Map{"error": false, "message_id": message.ID, "mediaURL": message.MediaURL, "thumbnailURL": message.ThumbnailURL})
}

type openedStorageUpload struct {
	upload services.StorageUpload
	file   multipart.File
}

func openStorageUpload(header *multipart.FileHeader) (*openedStorageUpload, error) {
	file, err := header.Open()
	if err != nil {
		return nil, err
	}
	return &openedStorageUpload{upload: services.StorageUpload{Source: file, Size: header.Size, ContentType: header.Header.Get("Content-Type")}, file: file}, nil
}

func (u *openedStorageUpload) close() { _ = u.file.Close() }

func (h *MessageController) MarkDelivered(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}

	input := &models.ReceiptRequest{}
	if err := c.BodyParser(input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}
	if input.ChatID == "" || len(input.MessageIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": "chatId and messageIds required"})
	}

	if err := h.service.MarkDelivered(context.Background(), input.ChatID, userID, input.MessageIDs); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	return c.JSON(fiber.Map{"error": false})
}

func (h *MessageController) MarkRead(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}

	input := &models.ReceiptRequest{}
	if err := c.BodyParser(input); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}
	if input.ChatID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": true, "msg": "chatId required"})
	}

	cleared, err := h.service.MarkRead(context.Background(), input.ChatID, userID, input.MessageIDs, input.ReadThroughMessageID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	return c.JSON(fiber.Map{"error": false, "clearedUnread": cleared})
}

func (h *MessageController) DeleteMessage(c *fiber.Ctx) error {
	userID, ok := c.Locals("userID").(string)
	if !ok || userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": true, "msg": "Unauthorized"})
	}

	chatID := c.Params("chatId")
	messageID := c.Params("messageId")

	if err := h.service.DeleteMessage(context.Background(), chatID, messageID, userID); err != nil {
		if svcErr, ok := err.(*services.ServiceError); ok {
			return c.Status(svcErr.Status).JSON(fiber.Map{"error": true, "msg": svcErr.Message})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": true, "msg": err.Error()})
	}

	return c.SendStatus(fiber.StatusNoContent)
}
