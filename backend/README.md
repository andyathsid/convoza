# Backend

For first-time local setup, use the [root README](../README.md).

This Go Fiber backend owns durable mutations and business-rule enforcement. This backend uses repository pattern that keeps HTTP concerns, application rules, and persistence concerns separate:

- `app/models` defines chat, message, user, and authentication data.
- `app/controllers` parses HTTP requests and shapes HTTP responses.
- `app/services` owns business rules and cross-resource workflows.
- `app/repository` defines persistence interfaces. PostgreSQL implementations satisfy the user-store interfaces.
- `pkg` contains application wiring: routes, middleware, configuration, and utilities.
- `platform` integrates PostgreSQL, Firebase Admin, Firestore, Storage validation, and Typesense.

Firebase Admin authenticates backend access. The Firestore wrapper owns chat and message persistence, while the PostgreSQL user store resolves participants and maintains user records. Storage validation protects uploaded media before it is persisted. Route ownership lives in `pkg/routes`, and Swagger is served at `http://localhost:5000/swagger/index.html`. When `TYPESENSE_API_KEY` is set, write-time indexing keeps Typesense collections current.

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

## Local commands

Use Air to run the backend development server with hot reload. Use `go run .` when hot reload is not needed.

```bash
go run .
air
go build -o build/apiserver .
go test ./app/services/...
go test ./pkg/routes/...
```

Apply migrations against the local Compose database with:

```bash
migrate -path platform/migrations -database "postgres://postgres:password@localhost:5432/chatapp?sslmode=disable" up
```

Development fixtures are available through `go run ./cmd/dev-seed` and `go run ./cmd/dev-seed-gap`. The programs under `cmd/maintenance/` repair existing data and are not part of first-time setup.
