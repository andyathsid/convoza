# Backend

For first-time local setup, use the [root README](../README.md).

This Go Fiber backend owns durable mutations and business-rule enforcement. Its clean architecture keeps dependencies pointed inward:

- `internal/domain` defines transport-neutral entities and repository contracts.
- `internal/app` owns use cases and ports for identity, storage, membership, and search.
- `internal/http` owns Fiber handlers, middleware, DTOs, and response mapping.
- `internal/platform` implements PostgreSQL, Firebase, Firestore, configuration, migrations, and Typesense.
- `cmd/app` is the composition root, and every operational command uses the same internal adapters.

Firebase Admin authenticates backend access. Firestore owns chat and message persistence, PostgreSQL owns users, and Storage validation protects uploaded media before it is persisted. Swagger is served at `http://localhost:5000/swagger/index.html`. When `TYPESENSE_API_KEY` is set, write-time indexing keeps Typesense collections current.

## Configuration

Copy `.env.example` to `.env`. Important variables are:

```ini
SERVER_PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=chatapp
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.your-region.firebasedatabase.app
FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
ALLOWED_ORIGINS=http://localhost:3001
TYPESENSE_URL=http://localhost:8108
TYPESENSE_API_KEY=
```

`DB_HOST` remains `localhost` for native execution. Compose supplies `db` for the containerized API. Use `xyz` as the API key for the local Compose Typesense service.
`SERVER_READ_TIMEOUT` is measured in seconds. `DB_MAX_LIFETIME_CONNECTIONS` is measured in minutes. Firestore-only operational commands require only `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT_PATH`; commands that also use PostgreSQL or Realtime Database validate those settings separately.

## Local commands

Use Air to run the backend development server with hot reload. Use `go run ./cmd/app` when hot reload is not needed.

```bash
go run ./cmd/app
air
go build -o build/apiserver ./cmd/app
go test ./internal/app/...
go test ./internal/http/...
```

Apply migrations against the local Compose database with:

```bash
migrate -path internal/platform/migrations -database "postgres://postgres:password@localhost:5432/chatapp?sslmode=disable" up
```

Development fixtures are available through `go run ./cmd/dev-seed` and `go run ./cmd/dev-seed-gap`. The programs under `cmd/maintenance/` repair existing data and are not part of first-time setup.
