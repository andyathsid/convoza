package routes

import (
	"github.com/andyathsid/backend/app/controllers"
	"github.com/andyathsid/backend/pkg/middleware"
	"github.com/gofiber/fiber/v2"
)

func PrivateRoutes(
	a *fiber.App,
	auth *controllers.AuthController,
	chat *controllers.ChatController,
	message *controllers.MessageController,
) {
	route := a.Group("/api/v1")

	// Chat
	route.Post("/chat/create", middleware.FirebaseAuth(), chat.CreateChat)
	route.Get("/chat/:id", middleware.FirebaseAuth(), chat.GetSingleChat)

	// Group members
	route.Post("/chat/:chatId/members", middleware.FirebaseAuth(), chat.AddMembers)
	route.Post("/chat/:chatId/members/:userId/remove", middleware.FirebaseAuth(), chat.RemoveMember)
	route.Post("/chat/:chatId/members/:userId/promote", middleware.FirebaseAuth(), chat.PromoteMember)
	route.Post("/chat/:chatId/members/:userId/demote", middleware.FirebaseAuth(), chat.DemoteMember)
	route.Post("/chat/:chatId/leave", middleware.FirebaseAuth(), chat.LeaveGroup)
	route.Post("/chat/:chatId/rename", middleware.FirebaseAuth(), chat.RenameGroup)
	route.Post("/chat/:chatId/avatar", middleware.FirebaseAuth(), chat.UpdateGroupAvatar)

	// Messages
	route.Post("/message/send", middleware.FirebaseAuth(), message.SendMessage)
	route.Post("/message/deliver", middleware.FirebaseAuth(), message.MarkDelivered)
	route.Post("/message/read", middleware.FirebaseAuth(), message.MarkRead)
	route.Delete("/chat/:chatId/message/:messageId", middleware.FirebaseAuth(), message.DeleteMessage)

	// Users
	route.Post("/users/avatar", middleware.FirebaseAuth(), auth.UpdateAvatar)
	route.Get("/users", middleware.FirebaseAuth(), chat.GetAllUsers)
	route.Get("/users/search", middleware.FirebaseAuth(), chat.SearchUsers)
	route.Post("/users/:userId/reindex-search", middleware.FirebaseAuth(), chat.ReindexUserSearch)
}
