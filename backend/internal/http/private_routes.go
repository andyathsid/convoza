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
) {
	route := a.Group("/api/v1")

	// Chat
	authenticated := FirebaseAuth(identity)
	route.Post("/chat/create", authenticated, chat.CreateChat)
	route.Get("/chat/:id", authenticated, chat.GetSingleChat)

	// Group members
	route.Post("/chat/:chatId/members", authenticated, chat.AddMembers)
	route.Post("/chat/:chatId/members/:userId/remove", authenticated, chat.RemoveMember)
	route.Post("/chat/:chatId/members/:userId/promote", authenticated, chat.PromoteMember)
	route.Post("/chat/:chatId/members/:userId/demote", authenticated, chat.DemoteMember)
	route.Post("/chat/:chatId/leave", authenticated, chat.LeaveGroup)
	route.Post("/chat/:chatId/rename", authenticated, chat.RenameGroup)
	route.Post("/chat/:chatId/avatar", authenticated, chat.UpdateGroupAvatar)

	// Messages
	route.Post("/message/send", authenticated, message.SendMessage)
	route.Post("/message/deliver", authenticated, message.MarkDelivered)
	route.Post("/message/read", authenticated, message.MarkRead)
	route.Delete("/chat/:chatId/message/:messageId", authenticated, message.DeleteMessage)

	// Users
	route.Post("/users/avatar", authenticated, auth.UpdateAvatar)
}
