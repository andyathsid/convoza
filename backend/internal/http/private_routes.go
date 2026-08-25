package http

import (
	"github.com/andyathsid/backend/internal/app"
	"github.com/gofiber/fiber/v2"
)

func PrivateRoutes(
	a *fiber.App,
	auth *AuthController,
	chat *ChatController,
	message *MessageController,
	identity app.IdentityProvider,
	sessionCookieName string,
	allowedOrigins string,
) {
	route := a.Group("/api/v1", FirebaseSessionAuth(identity, sessionCookieName), RequireTrustedOrigin(allowedOrigins))

	// Chat
	route.Post("/chat/create", chat.CreateChat)
	route.Get("/chat/:id", chat.GetSingleChat)

	// Group members
	route.Post("/chat/:chatId/members", chat.AddMembers)
	route.Post("/chat/:chatId/members/:userId/remove", chat.RemoveMember)
	route.Post("/chat/:chatId/members/:userId/promote", chat.PromoteMember)
	route.Post("/chat/:chatId/members/:userId/demote", chat.DemoteMember)
	route.Post("/chat/:chatId/leave", chat.LeaveGroup)
	route.Post("/chat/:chatId/rename", chat.RenameGroup)
	route.Post("/chat/:chatId/avatar", chat.UpdateGroupAvatar)

	// Messages
	route.Post("/message/send", message.SendMessage)
	route.Post("/message/deliver", message.MarkDelivered)
	route.Post("/message/read", message.MarkRead)
	route.Delete("/chat/:chatId/message/:messageId", message.DeleteMessage)

	// Users
	route.Post("/users/avatar", auth.UpdateAvatar)
}
