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
	"github.com/andyathsid/backend/internal/platform/database"
	firebaseplatform "github.com/andyathsid/backend/internal/platform/firebase"
	"github.com/andyathsid/backend/internal/platform/firestore"
	"github.com/andyathsid/backend/internal/platform/search"
	"github.com/gofiber/fiber/v2"

	_ "github.com/andyathsid/backend/docs"
	_ "github.com/joho/godotenv/autoload"
)

// @title Chat App API
// @version 1.0
// @description Chat App API with Firebase Auth and PostgreSQL.
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
	db, err := database.Open(cfg.Database)
	if err != nil {
		return fmt.Errorf("connect PostgreSQL: %w", err)
	}
	defer db.Close()
	users := database.NewUserRepositorySQL(db)
	var indexer application.SearchIndexer = application.NopSearchIndexer{}
	if cfg.Search.APIKey != "" {
		client := search.NewTypesenseClient(cfg.Search)
		if err := search.EnsureCollections(ctx, client); err != nil {
			log.Printf("typesense collection setup warning: %v", err)
		}
		indexer = search.NewIndexer(search.NewSyncService(client), store, store)
	}
	services := application.NewServices(application.Dependencies{
		Users: users, Profiles: store, Chats: store, Messages: store,
		Identity: firebaseClients.Identity, Search: indexer,
		Membership: firebaseClients.Membership, Storage: firebaseClients.Storage,
	})
	authController := transport.NewAuthController(services.Auth)
	server := fiber.New(transport.FiberConfig(cfg.Server.ReadTimeout, cfg.Server.BodyLimit))
	transport.FiberMiddleware(server, cfg.AllowedOrigins)
	transport.SwaggerRoute(server)
	transport.PublicRoutes(server, authController)
	transport.PrivateRoutes(server, authController, transport.NewChatController(services.Chat), transport.NewMessageController(services.Message), firebaseClients.Identity)
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
