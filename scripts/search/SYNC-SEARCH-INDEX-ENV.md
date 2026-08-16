# sync-search-index.js — Environment Variables

## Firebase (Required)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BACKEND_SA` | No | `backend/firebase-service-account.json` | Path to Firebase service account JSON |
| `GOOGLE_APPLICATION_CREDENTIALS` | No | — | Fallback if `BACKEND_SA` is not set |

## Search Engine

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SEARCH_ENGINE` | No | `typesense` | `typesense` / `meilisearch` / `algolia` |

## Typesense

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TYPESENSE_URL` | No | — | Full URL (overrides host/port) |
| `TYPESENSE_HOST` | No | `localhost` | Hostname |
| `TYPESENSE_PORT` | No | `8108` | Port |
| `TYPESENSE_API_KEY` | No | `xyz` | API key |

## Meilisearch

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MEILI_HOST` | No | `localhost` | Hostname |
| `MEILI_PORT` | No | `7700` | Port |
| `MEILI_MASTER_KEY` | No | `masterKey` | Master key |

## Algolia

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ALGOLIA_APP_ID` | Yes | — | Algolia application ID |
| `ALGOLIA_ADMIN_API_KEY` | Yes | — | Algolia admin API key |

---

## Usage

The script reads **one engine per run** via `SEARCH_ENGINE`. To sync to multiple engines, run multiple times:

```bash
SEARCH_ENGINE=typesense node scripts/sync-search-index.js
SEARCH_ENGINE=meilisearch node scripts/sync-search-index.js
```

### Example .env (sync to both Typesense + Meilisearch on VM)

```env
# Firebase
BACKEND_SA=./backend/firebase-service-account.json

# Typesense (VM)
SEARCH_ENGINE=typesense
TYPESENSE_URL=https://192.168.1.100:8108
TYPESENSE_API_KEY=your-typesense-api-key

# Meilisearch (VM)
MEILI_HOST=192.168.1.100
MEILI_PORT=7700
MEILI_MASTER_KEY=your-meili-master-key
```

### Using separate .env files per engine

```bash
# .env.typesense
SEARCH_ENGINE=typesense
TYPESENSE_URL=https://192.168.1.100:8108
TYPESENSE_API_KEY=your-typesense-api-key

# .env.meili
SEARCH_ENGINE=meilisearch
MEILI_HOST=192.168.1.100
MEILI_PORT=7700
MEILI_MASTER_KEY=your-meili-master-key
```

```bash
dotenv -e .env.typesense -- node scripts/sync-search-index.js
dotenv -e .env.meili -- node scripts/sync-search-index.js
```
