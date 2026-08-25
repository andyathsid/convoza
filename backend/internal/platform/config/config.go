package config

import (
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/spf13/viper"
)

const (
	defaultReadTimeoutSeconds = 60
)

type Config struct {
	Server         Server
	Firebase       Firebase
	Search         Search
	Auth           Auth
	AllowedOrigins string
}

type Server struct {
	Host        string
	Port        int
	ReadTimeout time.Duration
	BodyLimit   int
}

type Firebase struct {
	ProjectID, ServiceAccountPath, DatabaseURL, StorageBucket string
}

type Search struct {
	URL, APIKey string
}

type Auth struct {
	SessionCookieName   string
	SessionCookieMaxAge time.Duration
	SessionCookieSecure bool
}

type environment struct {
	ServerHost                 string `mapstructure:"SERVER_HOST"`
	ServerPort                 int    `mapstructure:"SERVER_PORT"`
	ServerReadTimeout          int    `mapstructure:"SERVER_READ_TIMEOUT"`
	ServerBodyLimitBytes       int    `mapstructure:"SERVER_BODY_LIMIT_BYTES"`
	FirebaseProjectID          string `mapstructure:"FIREBASE_PROJECT_ID"`
	FirebaseServiceAccountPath string `mapstructure:"FIREBASE_SERVICE_ACCOUNT_PATH"`
	FirebaseDatabaseURL        string `mapstructure:"FIREBASE_DATABASE_URL"`
	FirebaseStorageBucket      string `mapstructure:"FIREBASE_STORAGE_BUCKET"`
	AllowedOrigins             string `mapstructure:"ALLOWED_ORIGINS"`
	AuthSessionCookieName      string `mapstructure:"AUTH_SESSION_COOKIE_NAME"`
	AuthSessionCookieMaxAge    int    `mapstructure:"AUTH_SESSION_COOKIE_MAX_AGE_SECONDS"`
	AuthSessionCookieSecure    bool   `mapstructure:"AUTH_SESSION_COOKIE_SECURE"`
	MeiliURL                   string `mapstructure:"MEILI_URL"`
	MeiliAPIKey                string `mapstructure:"MEILI_API_KEY"`
}

var supportedEnvironmentKeys = []string{
	"SERVER_HOST",
	"SERVER_PORT",
	"SERVER_READ_TIMEOUT",
	"SERVER_BODY_LIMIT_BYTES",
	"FIREBASE_PROJECT_ID",
	"FIREBASE_SERVICE_ACCOUNT_PATH",
	"FIREBASE_DATABASE_URL",
	"FIREBASE_STORAGE_BUCKET",
	"ALLOWED_ORIGINS",
	"AUTH_SESSION_COOKIE_NAME",
	"AUTH_SESSION_COOKIE_MAX_AGE_SECONDS",
	"AUTH_SESSION_COOKIE_SECURE",
	"MEILI_URL",
	"MEILI_API_KEY",
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

func load() (Config, error) {
	v := viper.New()
	v.SetDefault("SERVER_HOST", "0.0.0.0")
	v.SetDefault("SERVER_PORT", 5000)
	v.SetDefault("SERVER_READ_TIMEOUT", defaultReadTimeoutSeconds)
	v.SetDefault("SERVER_BODY_LIMIT_BYTES", 32*1024*1024)
	v.SetDefault("ALLOWED_ORIGINS", "http://localhost:3000")
	v.SetDefault("AUTH_SESSION_COOKIE_NAME", "convoza_session")
	v.SetDefault("AUTH_SESSION_COOKIE_MAX_AGE_SECONDS", 12*24*60*60)
	v.SetDefault("AUTH_SESSION_COOKIE_SECURE", true)

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
		Firebase: Firebase{
			ProjectID:          strings.TrimSpace(env.FirebaseProjectID),
			ServiceAccountPath: strings.TrimSpace(env.FirebaseServiceAccountPath),
			DatabaseURL:        strings.TrimSpace(env.FirebaseDatabaseURL),
			StorageBucket:      strings.TrimSpace(env.FirebaseStorageBucket),
		},
		Search: Search{
			URL:    strings.TrimSpace(env.MeiliURL),
			APIKey: strings.TrimSpace(env.MeiliAPIKey),
		},
		Auth: Auth{
			SessionCookieName:   strings.TrimSpace(env.AuthSessionCookieName),
			SessionCookieMaxAge: time.Duration(env.AuthSessionCookieMaxAge) * time.Second,
			SessionCookieSecure: env.AuthSessionCookieSecure,
		},
		AllowedOrigins: strings.TrimSpace(env.AllowedOrigins),
	}, nil
}

func (c Config) Validate() error {
	if err := c.Server.Validate(); err != nil {
		return err
	}
	if err := c.Firebase.Validate(); err != nil {
		return err
	}
	if err := c.Search.Validate(); err != nil {
		return err
	}
	if err := c.Auth.Validate(); err != nil {
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
	return validateHTTPURL("MEILI_URL", c.URL)
}

func (c Auth) Validate() error {
	if c.SessionCookieName == "" {
		return fmt.Errorf("AUTH_SESSION_COOKIE_NAME is required")
	}
	if c.SessionCookieMaxAge < 5*time.Minute || c.SessionCookieMaxAge > 14*24*time.Hour {
		return fmt.Errorf("AUTH_SESSION_COOKIE_MAX_AGE_SECONDS must be between 300 and 1209600")
	}
	return nil
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
