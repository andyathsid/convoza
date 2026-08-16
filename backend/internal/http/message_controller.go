package http

import (
	"mime/multipart"
	"strconv"
	"strings"

	application "github.com/andyathsid/backend/internal/app"
	"github.com/gofiber/fiber/v2"
)

type MessageController struct {
	service *application.MessageService
}

func NewMessageController(service *application.MessageService) *MessageController {
	return &MessageController{service: service}
}

func (h *MessageController) SendMessage(c *fiber.Ctx) error {
	userID, err := authenticatedUserID(c)
	if err != nil {
		return writeError(c, err)
	}
	if strings.HasPrefix(c.Get("Content-Type"), "multipart/form-data") {
		return h.sendMediaMessage(c, userID)
	}
	input := &sendMessageRequest{}
	if err := c.BodyParser(input); err != nil {
		return writeError(c, application.InvalidInput("invalid request body", err))
	}
	messageID, err := h.service.SendMessage(c.UserContext(), input.ChatID, userID, input.input())
	if err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{"error": false, "message_id": messageID})
}

func (h *MessageController) sendMediaMessage(c *fiber.Ctx, userID string) error {
	mediaHeader, err := c.FormFile("media")
	if err != nil {
		return writeError(c, application.InvalidInput("media file is required", err))
	}
	media, err := openStorageUpload(mediaHeader)
	if err != nil {
		return writeError(c, application.InvalidInput("media file could not be opened", err))
	}
	defer media.close()

	var thumbnail *openedStorageUpload
	if thumbnailHeader, formErr := c.FormFile("thumbnail"); formErr == nil {
		thumbnail, err = openStorageUpload(thumbnailHeader)
		if err != nil {
			return writeError(c, application.InvalidInput("thumbnail file could not be opened", err))
		}
		defer thumbnail.close()
	}
	input := &sendMessageRequest{
		ChatID: c.FormValue("chatId"), Content: c.FormValue("content"), MediaType: c.FormValue("mediaType"),
		DocumentName: c.FormValue("documentName"), GroupID: c.FormValue("groupId"), ReplyToID: c.FormValue("replyToId"),
	}
	if input.ChatID == "" {
		return writeError(c, application.InvalidInput("chatId is required", nil))
	}
	if input.MediaWidth, err = optionalFormInt(c, "mediaWidth"); err != nil {
		return writeError(c, err)
	}
	if input.MediaHeight, err = optionalFormInt(c, "mediaHeight"); err != nil {
		return writeError(c, err)
	}
	if input.GroupIndex, err = optionalFormInt(c, "groupIndex"); err != nil {
		return writeError(c, err)
	}
	var thumbnailUpload *application.StorageUpload
	if thumbnail != nil {
		thumbnailUpload = &thumbnail.upload
	}
	message, err := h.service.SendMediaMessage(c.UserContext(), input.ChatID, userID, input.input(), media.upload, thumbnailUpload)
	if err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{
		"error": false, "message_id": message.ID, "mediaURL": message.MediaURL, "thumbnailURL": message.ThumbnailURL,
	})
}

func optionalFormInt(c *fiber.Ctx, key string) (int, error) {
	value := c.FormValue(key)
	if value == "" {
		return 0, nil
	}
	number, err := strconv.Atoi(value)
	if err != nil {
		return 0, application.InvalidInput(key+" must be an integer", err)
	}
	return number, nil
}

type openedStorageUpload struct {
	upload application.StorageUpload
	file   multipart.File
}

func openStorageUpload(header *multipart.FileHeader) (*openedStorageUpload, error) {
	file, err := header.Open()
	if err != nil {
		return nil, err
	}
	return &openedStorageUpload{
		upload: application.StorageUpload{Source: file, Size: header.Size, ContentType: header.Header.Get("Content-Type")},
		file:   file,
	}, nil
}

func (upload *openedStorageUpload) close() { _ = upload.file.Close() }

func (h *MessageController) MarkDelivered(c *fiber.Ctx) error {
	userID, err := authenticatedUserID(c)
	if err != nil {
		return writeError(c, err)
	}
	input := &receiptRequest{}
	if err := c.BodyParser(input); err != nil {
		return writeError(c, application.InvalidInput("invalid request body", err))
	}
	if input.ChatID == "" || len(input.MessageIDs) == 0 {
		return writeError(c, application.InvalidInput("chatId and messageIds required", nil))
	}
	if err := h.service.MarkDelivered(c.UserContext(), input.ChatID, userID, input.MessageIDs); err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{"error": false})
}

func (h *MessageController) MarkRead(c *fiber.Ctx) error {
	userID, err := authenticatedUserID(c)
	if err != nil {
		return writeError(c, err)
	}
	input := &receiptRequest{}
	if err := c.BodyParser(input); err != nil {
		return writeError(c, application.InvalidInput("invalid request body", err))
	}
	if input.ChatID == "" {
		return writeError(c, application.InvalidInput("chatId required", nil))
	}
	cleared, err := h.service.MarkRead(c.UserContext(), input.ChatID, userID, input.MessageIDs, input.ReadThroughMessageID)
	if err != nil {
		return writeError(c, err)
	}
	return c.JSON(fiber.Map{"error": false, "clearedUnread": cleared})
}

func (h *MessageController) DeleteMessage(c *fiber.Ctx) error {
	userID, err := authenticatedUserID(c)
	if err != nil {
		return writeError(c, err)
	}
	if err := h.service.DeleteMessage(c.UserContext(), c.Params("chatId"), c.Params("messageId"), userID); err != nil {
		return writeError(c, err)
	}
	return c.SendStatus(fiber.StatusNoContent)
}
