package config

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/spf13/viper"
)

const (
	defaultReadTimeoutSeconds = 60
	defaultDBLifetimeMinutes  = 2
)

type Config struct {
	Server         Server
	Database       Database
	Firebase       Firebase
	Search         Search
	AllowedOrigins string
}

type DatabaseFirebaseConfig struct {
	Database Database
	Firebase Firebase
}

type Server struct {
	Host        string
	Port        int
	ReadTimeout time.Duration
	BodyLimit   int
}

type Database struct {
	Host, Port, User, Password, Name, SSLMode string
	MaxOpen, MaxIdle                          int
	MaxLifetime                               time.Duration
}

type Firebase struct {
	ProjectID, ServiceAccountPath, DatabaseURL, StorageBucket string
}

type Search struct {
	URL, APIKey string
}

type environment struct {
	ServerHost                 string `mapstructure:"SERVER_HOST"`
	ServerPort                 int    `mapstructure:"SERVER_PORT"`
	ServerReadTimeout          int    `mapstructure:"SERVER_READ_TIMEOUT"`
	ServerBodyLimitBytes       int    `mapstructure:"SERVER_BODY_LIMIT_BYTES"`
	DBHost                     string `mapstructure:"DB_HOST"`
	DBPort                     string `mapstructure:"DB_PORT"`
	DBUser                     string `mapstructure:"DB_USER"`
	DBPassword                 string `mapstructure:"DB_PASSWORD"`
	DBName                     string `mapstructure:"DB_NAME"`
	DBSSLMode                  string `mapstructure:"DB_SSL_MODE"`
	DBMaxConnections           int    `mapstructure:"DB_MAX_CONNECTIONS"`
	DBMaxIdleConnections       int    `mapstructure:"DB_MAX_IDLE_CONNECTIONS"`
	DBMaxLifetimeConnections   int    `mapstructure:"DB_MAX_LIFETIME_CONNECTIONS"`
	FirebaseProjectID          string `mapstructure:"FIREBASE_PROJECT_ID"`
	FirebaseServiceAccountPath string `mapstructure:"FIREBASE_SERVICE_ACCOUNT_PATH"`
	FirebaseDatabaseURL        string `mapstructure:"FIREBASE_DATABASE_URL"`
	FirebaseStorageBucket      string `mapstructure:"FIREBASE_STORAGE_BUCKET"`
	AllowedOrigins             string `mapstructure:"ALLOWED_ORIGINS"`
	TypesenseURL               string `mapstructure:"TYPESENSE_URL"`
	TypesenseAPIKey            string `mapstructure:"TYPESENSE_API_KEY"`
}

var supportedEnvironmentKeys = []string{
	"SERVER_HOST",
	"SERVER_PORT",
	"SERVER_READ_TIMEOUT",
	"SERVER_BODY_LIMIT_BYTES",
	"DB_HOST",
	"DB_PORT",
	"DB_USER",
	"DB_PASSWORD",
	"DB_NAME",
	"DB_SSL_MODE",
	"DB_MAX_CONNECTIONS",
	"DB_MAX_IDLE_CONNECTIONS",
	"DB_MAX_LIFETIME_CONNECTIONS",
	"FIREBASE_PROJECT_ID",
	"FIREBASE_SERVICE_ACCOUNT_PATH",
	"FIREBASE_DATABASE_URL",
	"FIREBASE_STORAGE_BUCKET",
	"ALLOWED_ORIGINS",
	"TYPESENSE_URL",
	"TYPESENSE_API_KEY",
}

func Load() (Config, error) {
	cfg, err := load()
	if err != nil {
		return Config{}, err
	}
	return cfg, cfg.Validate()
}

func LoadFirebase() (Firebase, error) {
	cfg, err := load()
	if err != nil {
		return Firebase{}, err
	}
	return cfg.Firebase, cfg.Firebase.ValidateBase()
}

func LoadDatabaseAndFirebase() (DatabaseFirebaseConfig, error) {
	cfg, err := load()
	if err != nil {
		return DatabaseFirebaseConfig{}, err
	}
	if err := cfg.Database.Validate(); err != nil {
		return DatabaseFirebaseConfig{}, err
	}
	if err := cfg.Firebase.ValidateBase(); err != nil {
		return DatabaseFirebaseConfig{}, err
	}
	return DatabaseFirebaseConfig{Database: cfg.Database, Firebase: cfg.Firebase}, nil
}

func load() (Config, error) {
	v := viper.New()
	v.SetDefault("SERVER_HOST", "0.0.0.0")
	v.SetDefault("SERVER_PORT", 5000)
	v.SetDefault("SERVER_READ_TIMEOUT", defaultReadTimeoutSeconds)
	v.SetDefault("SERVER_BODY_LIMIT_BYTES", 32*1024*1024)
	v.SetDefault("DB_MAX_CONNECTIONS", 100)
	v.SetDefault("DB_MAX_IDLE_CONNECTIONS", 10)
	v.SetDefault("DB_MAX_LIFETIME_CONNECTIONS", defaultDBLifetimeMinutes)
	v.SetDefault("DB_SSL_MODE", "disable")
	v.SetDefault("ALLOWED_ORIGINS", "http://localhost:3000")

	for _, key := range supportedEnvironmentKeys {
		if err := v.BindEnv(key); err != nil {
			return Config{}, fmt.Errorf("bind %s: %w", key, err)
		}
	}

	var env environment
	if err := v.Unmarshal(&env); err != nil {
		return Config{}, fmt.Errorf("decode environment configuration: %w", err)
	}

	return Config{
		Server: Server{
			Host:        strings.TrimSpace(env.ServerHost),
			Port:        env.ServerPort,
			ReadTimeout: time.Duration(env.ServerReadTimeout) * time.Second,
			BodyLimit:   env.ServerBodyLimitBytes,
		},
		Database: Database{
			Host:        strings.TrimSpace(env.DBHost),
			Port:        strings.TrimSpace(env.DBPort),
			User:        strings.TrimSpace(env.DBUser),
			Password:    env.DBPassword,
			Name:        strings.TrimSpace(env.DBName),
			SSLMode:     strings.TrimSpace(env.DBSSLMode),
			MaxOpen:     env.DBMaxConnections,
			MaxIdle:     env.DBMaxIdleConnections,
			MaxLifetime: time.Duration(env.DBMaxLifetimeConnections) * time.Minute,
		},
		Firebase: Firebase{
			ProjectID:          strings.TrimSpace(env.FirebaseProjectID),
			ServiceAccountPath: strings.TrimSpace(env.FirebaseServiceAccountPath),
			DatabaseURL:        strings.TrimSpace(env.FirebaseDatabaseURL),
			StorageBucket:      strings.TrimSpace(env.FirebaseStorageBucket),
		},
		Search: Search{
			URL:    strings.TrimSpace(env.TypesenseURL),
			APIKey: strings.TrimSpace(env.TypesenseAPIKey),
		},
		AllowedOrigins: strings.TrimSpace(env.AllowedOrigins),
	}, nil
}

func (c Config) Validate() error {
	if err := c.Server.Validate(); err != nil {
		return err
	}
	if err := c.Database.Validate(); err != nil {
		return err
	}
	if err := c.Firebase.Validate(); err != nil {
		return err
	}
	if err := c.Search.Validate(); err != nil {
		return err
	}
	if c.AllowedOrigins == "" {
		return fmt.Errorf("ALLOWED_ORIGINS is required")
	}
	return nil
}

func (c Server) Validate() error {
	if c.Host == "" {
		return fmt.Errorf("SERVER_HOST is required")
	}
	if c.Port < 1 || c.Port > 65535 {
		return fmt.Errorf("SERVER_PORT must be between 1 and 65535")
	}
	if c.ReadTimeout <= 0 {
		return fmt.Errorf("SERVER_READ_TIMEOUT must be greater than zero")
	}
	if c.BodyLimit <= 0 {
		return fmt.Errorf("SERVER_BODY_LIMIT_BYTES must be greater than zero")
	}
	return nil
}

func (c Database) Validate() error {
	if c.Host == "" || c.User == "" || c.Name == "" || c.SSLMode == "" {
		return fmt.Errorf("incomplete PostgreSQL configuration")
	}
	port, err := strconv.Atoi(c.Port)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("DB_PORT must be a number between 1 and 65535")
	}
	if c.MaxOpen < 1 {
		return fmt.Errorf("DB_MAX_CONNECTIONS must be greater than zero")
	}
	if c.MaxIdle < 0 || c.MaxIdle > c.MaxOpen {
		return fmt.Errorf("DB_MAX_IDLE_CONNECTIONS must be between zero and DB_MAX_CONNECTIONS")
	}
	if c.MaxLifetime <= 0 {
		return fmt.Errorf("DB_MAX_LIFETIME_CONNECTIONS must be greater than zero")
	}
	return nil
}

func (c Firebase) Validate() error {
	if err := c.ValidateDatabase(); err != nil {
		return err
	}
	if c.StorageBucket == "" {
		return fmt.Errorf("FIREBASE_STORAGE_BUCKET is required")
	}
	return nil
}

func (c Firebase) ValidateDatabase() error {
	if err := c.ValidateBase(); err != nil {
		return err
	}
	return validateHTTPURL("FIREBASE_DATABASE_URL", c.DatabaseURL)
}

func (c Firebase) ValidateBase() error {
	if c.ProjectID == "" {
		return fmt.Errorf("FIREBASE_PROJECT_ID is required")
	}
	if c.ServiceAccountPath == "" {
		return fmt.Errorf("FIREBASE_SERVICE_ACCOUNT_PATH is required")
	}
	return nil
}

func (c Search) Validate() error {
	if c.APIKey == "" {
		return nil
	}
	return validateHTTPURL("TYPESENSE_URL", c.URL)
}

func validateHTTPURL(name, value string) error {
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Host == "" {
		return fmt.Errorf("%s must be an absolute HTTP URL with a host", name)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("%s must use http or https", name)
	}
	return nil
}
