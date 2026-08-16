import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import {
  getDatabase,
  ref,
  onValue,
  onDisconnect,
  set as rtdbSet,
  serverTimestamp as rtdbTimestamp,
  type Database,
} from "firebase/database";
import { getStorage, type FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
};

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;
let rtdb: Database | undefined;
let storage: FirebaseStorage | undefined;
let googleProvider: GoogleAuthProvider | undefined;

if (firebaseConfig.apiKey) {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  auth = getAuth(app);
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
  rtdb = getDatabase(app);
  storage = getStorage(app);
  googleProvider = new GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: "select_account" });
  googleProvider.addScope('profile');
  googleProvider.addScope('email');
}

export { app, auth, db, rtdb, storage, googleProvider };

// ── Presence (Realtime Database onDisconnect) ─────────────────────────
//
// Uses Firebase RTDB's native .info/connected + onDisconnect() for
// server-driven disconnect detection. Clients listen to /status/ in
// RTDB directly: no Cloud Function bridge needed.

let presenceUnsubscribe: (() => void) | null = null;
let currentPresenceUserId: string | null = null;

export function startPresence(userId: string) {
  if (!rtdb || currentPresenceUserId === userId) return;
  stopPresence();
  currentPresenceUserId = userId;

  const connectedRef = ref(rtdb, ".info/connected");
  const userStatusRTRef = ref(rtdb, `/status/${userId}`);

  const isOfflineRT = { state: "offline", last_changed: rtdbTimestamp() };
  const isOnlineRT = { state: "online", last_changed: rtdbTimestamp() };

  const unsub = onValue(connectedRef, (snapshot) => {
    const connected = snapshot.val();

    if (connected === false) {
      return;
    }

    // Connected: register onDisconnect, then write online
    onDisconnect(userStatusRTRef)
      .set(isOfflineRT)
      .then(() => {
        rtdbSet(userStatusRTRef, isOnlineRT).catch(() => {});
      })
      .catch(() => {});
  });

  presenceUnsubscribe = unsub;
}

export function stopPresence() {
  if (presenceUnsubscribe) {
    presenceUnsubscribe();
    presenceUnsubscribe = null;
  }

  if (currentPresenceUserId && rtdb) {
    const userStatusRTRef = ref(rtdb, `/status/${currentPresenceUserId}`);
    rtdbSet(userStatusRTRef, {
      state: "offline",
      last_changed: rtdbTimestamp(),
    }).catch(() => {});
  }

  currentPresenceUserId = null;
}

// ── Read Receipts ─────────────────────────────────────────────────────

/**
 * Mark messages as delivered for the current user.
 * Routes through backend API so Typesense index stays in sync.
 */
export async function markMessagesDelivered(
  chatId: string,
  messageIds: string[],
  userId: string
) {
  if (messageIds.length === 0) return;
  try {
    const { api } = await import("./api");
    await api.post("/message/deliver", { chatId, messageIds });
    console.log(`[ReadReceipts] Marked ${messageIds.length} messages as delivered`);
  } catch (err) {
    console.error("[ReadReceipts] Failed to mark delivered:", err);
  }
}

/**
 * Mark messages as read for the current user.
 * Routes through backend API so Typesense index stays in sync.
 */
export async function markMessagesAsRead(
  chatId: string,
  messageIds: string[],
  userId: string,
  readThroughMessageId?: string,
) {
  if (messageIds.length === 0 && !readThroughMessageId) return false;
  try {
    const { api } = await import("./api");
    const response = await api.post("/message/read", { chatId, messageIds, readThroughMessageId });
    console.log(`[ReadReceipts] Marked ${messageIds.length} messages as read`);
    return response.clearedUnread === true;
  } catch (err) {
    console.error("[ReadReceipts] Failed to mark read:", err);
    return false;
  }
}
