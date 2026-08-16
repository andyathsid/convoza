package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadBindsEnvironmentAndAppliesDefaults(t *testing.T) {
	setValidEnvironment(t)
	t.Setenv("SERVER_PORT", "5050")
	t.Setenv("SERVER_BODY_LIMIT_BYTES", "1024")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	if cfg.Server.Port != 5050 || cfg.Server.BodyLimit != 1024 {
		t.Fatalf("unexpected server config: %#v", cfg.Server)
	}
	if cfg.Server.ReadTimeout != 60*time.Second {
		t.Fatalf("expected a 60-second read timeout, got %s", cfg.Server.ReadTimeout)
	}
	if cfg.Database.MaxOpen != 100 || cfg.Database.MaxIdle != 10 {
		t.Fatalf("unexpected database pool defaults: %#v", cfg.Database)
	}
	if cfg.Database.MaxLifetime != 2*time.Minute {
		t.Fatalf("expected a two-minute database lifetime, got %s", cfg.Database.MaxLifetime)
	}
	if cfg.Firebase.ProjectID != "chat-project" {
		t.Fatalf("expected the explicitly bound Firebase project, got %q", cfg.Firebase.ProjectID)
	}
}

func TestLoadRejectsInvalidSemanticValues(t *testing.T) {
	tests := []struct {
		name    string
		key     string
		value   string
		message string
	}{
		{name: "missing project", key: "FIREBASE_PROJECT_ID", value: "", message: "FIREBASE_PROJECT_ID"},
		{name: "non-numeric database port", key: "DB_PORT", value: "postgres", message: "DB_PORT"},
		{name: "out-of-range database port", key: "DB_PORT", value: "70000", message: "DB_PORT"},
		{name: "idle pool exceeds open pool", key: "DB_MAX_IDLE_CONNECTIONS", value: "101", message: "DB_MAX_IDLE_CONNECTIONS"},
		{name: "zero open pool", key: "DB_MAX_CONNECTIONS", value: "0", message: "DB_MAX_CONNECTIONS"},
		{name: "firebase URL has no host", key: "FIREBASE_DATABASE_URL", value: "https:///database", message: "FIREBASE_DATABASE_URL"},
		{name: "firebase URL has invalid scheme", key: "FIREBASE_DATABASE_URL", value: "ftp://chat.example.test", message: "must use http or https"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setValidEnvironment(t)
			t.Setenv(test.key, test.value)
			_, err := Load()
			if err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("expected error containing %q, got %v", test.message, err)
			}
		})
	}
}

func TestLoadAllowsDisabledSearchWithoutURL(t *testing.T) {
	setValidEnvironment(t)
	t.Setenv("TYPESENSE_API_KEY", "")
	t.Setenv("TYPESENSE_URL", "")
	if _, err := Load(); err != nil {
		t.Fatalf("disabled search should not require a URL: %v", err)
	}
}

func TestLoadRejectsEnabledSearchWithInvalidURL(t *testing.T) {
	setValidEnvironment(t)
	t.Setenv("TYPESENSE_API_KEY", "enabled")
	t.Setenv("TYPESENSE_URL", "tcp://typesense.example.test:8108")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "must use http or https") {
		t.Fatalf("expected invalid Typesense scheme error, got %v", err)
	}
}

func TestLoadFirebaseDoesNotRequireUnrelatedServices(t *testing.T) {
	clearSupportedEnvironment(t)
	t.Setenv("FIREBASE_PROJECT_ID", "chat-project")
	t.Setenv("FIREBASE_SERVICE_ACCOUNT_PATH", "service.json")

	cfg, err := LoadFirebase()
	if err != nil {
		t.Fatalf("load Firebase-only configuration: %v", err)
	}
	if cfg.ProjectID != "chat-project" || cfg.ServiceAccountPath != "service.json" {
		t.Fatalf("unexpected Firebase config: %#v", cfg)
	}
}

func TestLoadDatabaseAndFirebaseDoesNotRequireServerOrFirebaseOptionalServices(t *testing.T) {
	clearSupportedEnvironment(t)
	setDatabaseEnvironment(t)
	t.Setenv("FIREBASE_PROJECT_ID", "chat-project")
	t.Setenv("FIREBASE_SERVICE_ACCOUNT_PATH", "service.json")

	cfg, err := LoadDatabaseAndFirebase()
	if err != nil {
		t.Fatalf("load database and Firebase configuration: %v", err)
	}
	if cfg.Database.Port != "5432" || cfg.Firebase.ProjectID != "chat-project" {
		t.Fatalf("unexpected scoped configuration: %#v", cfg)
	}
}

func setValidEnvironment(t *testing.T) {
	t.Helper()
	clearSupportedEnvironment(t)
	setDatabaseEnvironment(t)
	t.Setenv("FIREBASE_PROJECT_ID", "chat-project")
	t.Setenv("FIREBASE_SERVICE_ACCOUNT_PATH", "service.json")
	t.Setenv("FIREBASE_DATABASE_URL", "https://chat.example.test")
	t.Setenv("FIREBASE_STORAGE_BUCKET", "chat.example.test")
	t.Setenv("TYPESENSE_API_KEY", "")
}

func setDatabaseEnvironment(t *testing.T) {
	t.Helper()
	t.Setenv("DB_HOST", "db")
	t.Setenv("DB_PORT", "5432")
	t.Setenv("DB_USER", "chat")
	t.Setenv("DB_PASSWORD", "secret")
	t.Setenv("DB_NAME", "chat")
}

func clearSupportedEnvironment(t *testing.T) {
	t.Helper()
	for _, key := range supportedEnvironmentKeys {
		t.Setenv(key, "")
	}
}
