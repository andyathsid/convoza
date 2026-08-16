package main

import (
	"context"
	"log"
	"os"

	"github.com/andyathsid/backend/app/controllers"
	"github.com/andyathsid/backend/app/services"
	"github.com/andyathsid/backend/pkg/configs"
	"github.com/andyathsid/backend/pkg/middleware"
	"github.com/andyathsid/backend/pkg/routes"
	"github.com/andyathsid/backend/pkg/utils"
	"github.com/andyathsid/backend/platform/database"
	"github.com/andyathsid/backend/platform/database/repositories"
	firebaseInit "github.com/andyathsid/backend/platform/firebase"
	fsClient "github.com/andyathsid/backend/platform/firestore"
	"github.com/andyathsid/backend/platform/search"

	"github.com/gofiber/fiber/v2"

	_ "github.com/andyathsid/backend/docs"
	_ "github.com/joho/godotenv/autoload"
)

// @title Chat App API
// @version 1.0
// @description Chat App API with Firebase Auth and PostgreSQL.
// @termsOfService http://swagger.io/terms/
// @contact.name API Support
// @contact.email your@mail.com
// @license.name Apache 2.0
// @license.url http://www.apache.org/licenses/LICENSE-2.0.html
// @BasePath /api
// @securityDefinitions.apikey ApiKeyAuth
// @in header
// @name Authorization
func main() {
	config := configs.FiberConfig()
	app := fiber.New(config)
	middleware.FiberMiddleware(app)

	// Firebase
	if err := firebaseInit.InitFirebase(); err != nil {
		log.Fatalf("firebase init failed: %v", err)
	}

	// Firestore client wrapper
	firestore, err := fsClient.NewFirestoreClient(firebaseInit.App)
	if err != nil {
		log.Fatalf("firestore init failed: %v", err)
	}
	defer firestore.Close()

	// PostgreSQL
	db, err := database.OpenDBConnection()
	if err != nil {
		log.Fatalf("database connection failed: %v", err)
	}

	// Repository implementations (users + auth only; chat/message data lives in Firestore)
	userRepo := repositories.NewUserRepositorySQL(db)

	// Typesense search sync (optional, enabled when TYPESENSE_API_KEY is set)
	var searchSync *search.SyncService
	if os.Getenv("TYPESENSE_API_KEY") != "" {
		tsClient := search.NewTypesenseClient()
		if err := search.EnsureCollections(context.Background(), tsClient); err != nil {
			log.Printf("typesense collection setup warning: %v", err)
		}
		searchSync = search.NewSyncService(tsClient)

		// Reconciliation is disabled for now, write-time indexing already keeps the
		// search data current enough for the current product needs.
		// reconciler := search.NewReconciler(searchSync, firestore.Client, search.ReconcileIntervalFromEnv())
		// reconciler.Start(context.Background())
	}

	// Services
	authService := services.NewAuthService(userRepo, firestore, searchSync, firebaseInit.StorageObjects)
	chatService := services.NewChatService(userRepo, firestore, searchSync, firebaseInit.RTDBMembershipMirror, firebaseInit.StorageObjects)
	messageService := services.NewMessageService(userRepo, firestore, searchSync, firebaseInit.StorageObjects)

	// Controllers
	authController := controllers.NewAuthController(authService)
	chatController := controllers.NewChatController(chatService)
	messageController := controllers.NewMessageController(messageService)

	// Routes
	routes.SwaggerRoute(app)
	routes.PublicRoutes(app, authController)
	routes.PrivateRoutes(app, authController, chatController, messageController)
	routes.NotFoundRoute(app)

	utils.StartServerWithGracefulShutdown(app)
}
