# `sync-search-index.js` environment variables

The script rebuilds all Meilisearch indexes from Firestore. It deletes and
recreates `messages`, `chats`, `contacts`, and `groups` on every run.

## Firebase credentials

| Variable | Required | Description |
| --- | --- | --- |
| `BACKEND_SA` | No | Service-account JSON path. Defaults to `backend/firebase-service-account.json`. |
| `GOOGLE_APPLICATION_CREDENTIALS` | No | Application Default Credentials fallback. |

## Meilisearch

| Variable | Required | Description |
| --- | --- | --- |
| `MEILI_URL` | Yes | Absolute Meilisearch URL, for example `http://localhost:7700`. |
| `MEILI_API_KEY` | Yes | Privileged key allowed to delete/create indexes, update settings, and add documents. |

## Usage

```bash
cd scripts
npm run search:sync
```

The script loads `scripts/.env` when present. Alternatively, set the variables
in the shell before running it. Do not use the frontend search key: it permits
searching only and cannot rebuild indexes.
