# Frontend

For first-time local setup, use the [root README](../README.md).

This Next.js 16 application uses App Router route groups: `(auth)` serves sign-in and sign-up flows, while `(main)` holds authenticated chat routes. Firebase client auth powers the realtime Firebase SDKs, the Go API owns its separate HTTP-only session cookie.

Use npm as the package manager for this frontend. Yarn may work, but the project is not yet optimized for it.

`src/lib/firebase.ts` initializes the Firebase client. The frontend reads and listens to Firestore, Realtime Database, and Storage directly for real-time chat data. Zustand slices manage chat-list listeners, message pagination and cache, sending and optimistic messages, and presence. Chat UI lives in `src/components/chat`, with the virtualized message body, bubbles, composer, header, chat list, media lightbox, and group management UI.

Frontend mutations use the Go API instead of direct Firestore writes. The only exceptions are connection-bound Realtime Database presence and typing operations, because they require client connection lifecycle behavior.

## Configuration

Copy `.env.example` to `.env.local` and supply the Firebase web-app values:

```ini
NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_DATABASE_URL=
```

The local server runs on port 3001. Meilisearch client settings are `NEXT_PUBLIC_SEARCH_ENGINE=meilisearch`, `NEXT_PUBLIC_MEILI_URL=http://localhost:7700`, and `NEXT_PUBLIC_MEILI_SEARCH_KEY`. The search key must be restricted to the `search` action; see the root [development runbook](../docs/meilisearch-development-runbook.md). When `NEXT_PUBLIC_SEARCH_ENGINE` is unset, the frontend uses its no-results client.

For production, set `NEXT_PUBLIC_API_URL=https://convoza-api.andakaraas.com/api/v1`. The Go API must allow `https://convoza.andakaraas.com` as its exact credentialed CORS origin.

## Local commands

```bash
npm run dev
npx tsc --noEmit
npm run lint
npm run test:rules
```

> [!NOTE]
> React Compiler is enabled. 
