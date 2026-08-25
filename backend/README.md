# Backend

For first-time local setup, use the [root README](../README.md).

This Go Fiber backend owns durable mutations and business-rule enforcement. Its adapt clean architecture to keeps dependencies pointed inward:

- `internal/domain` defines transport-neutral entities and repository contracts.
- `internal/app` owns use cases and ports for identity, storage, membership, and search.
- `internal/http` owns Fiber handlers, middleware, DTOs, and response mapping.
- `internal/platform` implements Firebase, Firestore, configuration, and Meilisearch.
- `cmd/app` is the composition root, and every operational command uses the same internal adapters.

Firebase Auth owns account identity and email. Firestore owns public profiles, chat, and message persistence, while Storage validation protects uploaded media before it is persisted. Swagger is served at `http://localhost:5000/swagger/index.html`. Meilisearch indexes contacts and messages when configured.

## Configuration

Copy `.env.example` to `.env`. Important variables are:

```ini
SERVER_PORT=5000
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.your-region.firebasedatabase.app
FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
ALLOWED_ORIGINS=http://localhost:3001
AUTH_SESSION_COOKIE_NAME=convoza_session
AUTH_SESSION_COOKIE_MAX_AGE_SECONDS=1036800
AUTH_SESSION_COOKIE_SECURE=false
MEILI_URL=http://localhost:7700
MEILI_API_KEY=
```

Use `MEILI_API_KEY` as the privileged backend key; the development Compose stack also uses it as Meilisearch's master key. `SERVER_READ_TIMEOUT` is measured in seconds. Firebase-only operational commands require `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT_PATH`; commands using presence also require the Realtime Database URL.

The browser exchanges its Firebase ID token at `POST /api/v1/auth/session`; the Go API returns a host-only, HTTP-only Firebase session cookie and protects all other API routes with it. In production set `ALLOWED_ORIGINS=https://app.domain.com` and `AUTH_SESSION_COOKIE_SECURE=true`.

## Local commands

Use Air to run the backend development server with hot reload. Use `go run ./cmd/app` when hot reload is not needed.

```bash
go run ./cmd/app
air
go build -o build/apiserver ./cmd/app
go test ./internal/app/...
go test ./internal/http/...
```

Development fixtures are available through `go run ./cmd/dev-seed` and `go run ./cmd/dev-seed-gap`. The programs under `cmd/maintenance/` repair existing data and are not part of first-time setup.
