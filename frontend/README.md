# Frontend

For first-time local setup, use the [root README](../README.md).

This Next.js 16 application uses App Router route groups: `(auth)` serves sign-in and sign-up flows, while `(main)` holds authenticated chat routes. `src/proxy.ts` is the cookie-auth boundary, built with `next-firebase-auth-edge`.

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
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
AUTH_COOKIE_NAME=__session
AUTH_COOKIE_SIGNATURE_KEYS=
```

The local server runs on port 3001. Typesense client settings are `NEXT_PUBLIC_SEARCH_ENGINE=typesense`, `NEXT_PUBLIC_TYPESENSE_HOST=localhost`, `NEXT_PUBLIC_TYPESENSE_PORT=8108`, and `NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY=xyz`. When `NEXT_PUBLIC_SEARCH_ENGINE` is unset, the frontend uses its no-results client.

## Local commands

```bash
npm run dev
npx tsc --noEmit
npm run lint
npm run test:rules
```

> [!NOTE]
> React Compiler is enabled. 
