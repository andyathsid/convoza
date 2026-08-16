import {
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set,
} from "firebase/database";
import { rtdb } from "@/lib/firebase";

let presenceUnsubscribe: (() => void) | null = null;
let currentPresenceUserId: string | null = null;

export function startPresence(userId: string) {
  if (!rtdb || currentPresenceUserId === userId) return;

  stopPresence();
  currentPresenceUserId = userId;

  const connectedRef = ref(rtdb, ".info/connected");
  const userStatusRef = ref(rtdb, `/status/${userId}`);
  const offlineStatus = { state: "offline", last_changed: serverTimestamp() };
  const onlineStatus = { state: "online", last_changed: serverTimestamp() };

  presenceUnsubscribe = onValue(connectedRef, (snapshot) => {
    if (snapshot.val() === false) return;

    onDisconnect(userStatusRef)
      .set(offlineStatus)
      .then(() => set(userStatusRef, onlineStatus))
      .catch(() => {});
  });
}

export function stopPresence() {
  presenceUnsubscribe?.();
  presenceUnsubscribe = null;

  if (currentPresenceUserId && rtdb) {
    const userStatusRef = ref(rtdb, `/status/${currentPresenceUserId}`);
    void set(userStatusRef, {
      state: "offline",
      last_changed: serverTimestamp(),
    }).catch(() => {});
  }

  currentPresenceUserId = null;
}
