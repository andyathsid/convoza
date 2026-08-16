// frontend/src/stores/slices/presence-slice.ts
import type { StateCreator } from "zustand";
import type { ChatState } from "./types";
import { rtdb } from "@/lib/firebase";
import { ref, onValue } from "firebase/database";

export interface PresenceSlice {
  presenceMap: Record<string, boolean>;
  presenceUnsubscribe: (() => void) | null;
  listenPresence: () => void;
  stopListeningPresence: () => void;
}

export const createPresenceSlice: StateCreator<
  ChatState,
  [],
  [],
  PresenceSlice
> = (set, get) => ({
  presenceMap: {},
  presenceUnsubscribe: null,

  listenPresence: () => {
    const prev = get().presenceUnsubscribe;
    if (prev) prev();

    if (!rtdb) return;

    const statusRef = ref(rtdb, "/status");
    const unsub = onValue(statusRef, (snapshot) => {
      const data = snapshot.val();
      const map: Record<string, boolean> = {};
      if (data) {
        for (const [uid, val] of Object.entries(data)) {
          map[uid] = (val as any)?.state === "online";
        }
      }
      set({ presenceMap: map });
    });

    set({ presenceUnsubscribe: unsub });
  },

  stopListeningPresence: () => {
    const unsub = get().presenceUnsubscribe;
    if (unsub) unsub();
    set({ presenceUnsubscribe: null, presenceMap: {} });
  },
});
