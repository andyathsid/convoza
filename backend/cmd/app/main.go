package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	application "github.com/andyathsid/backend/internal/app"
	transport "github.com/andyathsid/backend/internal/http"
	"github.com/andyathsid/backend/internal/platform/config"
	firebaseplatform "github.com/andyathsid/backend/internal/platform/firebase"
	"github.com/andyathsid/backend/internal/platform/firestore"
	"github.com/andyathsid/backend/internal/platform/search"
	"github.com/gofiber/fiber/v2"

	_ "github.com/andyathsid/backend/docs"
	_ "github.com/joho/godotenv/autoload"
)

// @title Chat App API
// @version 1.0
// @description Chat App API with Firebase Auth and Firestore.
// @BasePath /api
// @securityDefinitions.apikey ApiKeyAuth
// @in header
// @name Authorization
func main() {
	if err := run(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}
	firebaseClients, err := firebaseplatform.New(ctx, cfg.Firebase)
	if err != nil {
		return fmt.Errorf("initialize Firebase: %w", err)
	}
	store, err := firestore.NewFirestoreClient(firebaseClients.App)
	if err != nil {
		return fmt.Errorf("initialize Firestore: %w", err)
	}
	defer store.Close()
	var indexer application.SearchIndexer = application.NopSearchIndexer{}
	var searchClient transport.SearchClient
	if cfg.Search.APIKey != "" {
		client := search.NewMeiliClient(cfg.Search)
		if err := search.EnsureIndexes(client); err != nil {
			log.Printf("meilisearch index setup warning: %v", err)
		}
		indexer = search.NewIndexer(search.NewSyncService(client), store, store)
		searchClient = client
	}
	services := application.NewServices(application.Dependencies{
		Users: store, Profiles: store, Chats: store, Messages: store,
		Identity: firebaseClients.Identity, Search: indexer,
		Membership: firebaseClients.Membership, Storage: firebaseClients.Storage,
	})
	authController := transport.NewAuthController(services.Auth, transport.SessionCookieConfig{
		Name: cfg.Auth.SessionCookieName, MaxAge: cfg.Auth.SessionCookieMaxAge, Secure: cfg.Auth.SessionCookieSecure,
	})
	server := fiber.New(transport.FiberConfig(cfg.Server.ReadTimeout, cfg.Server.BodyLimit))
	transport.FiberMiddleware(server, cfg.AllowedOrigins)
	transport.SwaggerRoute(server)
	transport.PublicRoutes(server, authController, cfg.AllowedOrigins)
	transport.PrivateRoutes(server, authController, transport.NewChatController(services.Chat), transport.NewMessageController(services.Message), transport.NewSearchController(searchClient), firebaseClients.Identity, cfg.Auth.SessionCookieName, cfg.AllowedOrigins)
	transport.NotFoundRoute(server)
	return serve(server, fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port))
}

func serve(server *fiber.App, address string) error {
	errCh := make(chan error, 1)
	go func() { errCh <- server.Listen(address) }()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	select {
	case err := <-errCh:
		return err
	case <-signals:
		return server.Shutdown()
	}
}
