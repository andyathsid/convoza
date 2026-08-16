package app

import "github.com/andyathsid/backend/internal/domain"

type Dependencies struct {
	Users      domain.UserRepository
	Profiles   domain.UserProfileRepository
	Chats      domain.ChatRepository
	Messages   domain.MessageRepository
	Identity   IdentityProvider
	Search     SearchIndexer
	Membership MembershipMirror
	Storage    ObjectStore
}

type Services struct {
	Auth    *AuthService
	Chat    *ChatService
	Message *MessageService
}

func NewServices(dependencies Dependencies) Services {
	search := dependencies.Search
	if search == nil {
		search = NopSearchIndexer{}
	}
	return Services{
		Auth:    NewAuthService(dependencies.Users, dependencies.Profiles, dependencies.Identity, search, dependencies.Storage),
		Chat:    NewChatService(dependencies.Users, dependencies.Chats, search, dependencies.Membership, dependencies.Storage),
		Message: NewMessageService(dependencies.Users, dependencies.Messages, search, dependencies.Storage),
	}
}
