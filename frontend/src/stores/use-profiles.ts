import { create } from "zustand";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

export interface Profile {
  username: string;
  avatar: string;
}

interface ProfileStore {
  profiles: Map<string, Profile>;
  loading: Set<string>;
  missing: Set<string>;
  getProfile: (uid: string) => Profile | undefined;
  ensureProfiles: (uids: string[]) => Promise<void>;

  // ── ALTERNATIVE: Realtime listener ──────────────────────────
  //
  // listeners: Map<string, () => void>;
  // subscribeToProfile: (uid: string) => void;
  // unsubscribeAll: () => void;
}

const profileRequests = new Map<string, Promise<void>>();

export const useProfiles = create<ProfileStore>((set, get) => ({
  profiles: new Map(),
  loading: new Set(),
  missing: new Set(),

  getProfile: (uid) => get().profiles.get(uid),

  ensureProfiles: async (uids) => {
    const uniqueUids = [...new Set(uids.filter(Boolean))];
    const requests = uniqueUids.flatMap((uid) => {
      const { profiles, missing } = get();
      if (profiles.has(uid) || missing.has(uid)) return [];

      const existing = profileRequests.get(uid);
      if (existing) return [existing];

      if (!db) {
        set((state) => ({
          missing: new Set([...state.missing, uid]),
        }));
        return [];
      }

      set((state) => ({
        loading: new Set([...state.loading, uid]),
      }));

      const request = getDoc(doc(db, "users", uid))
        .then((snapshot) => {
          set((state) => {
            const profiles = new Map(state.profiles);
            const loading = new Set(state.loading);
            const missing = new Set(state.missing);
            loading.delete(uid);

            if (!snapshot.exists()) {
              missing.add(uid);
              return { profiles, loading, missing };
            }

            const data = snapshot.data();
            const nextProfile = {
              username: data.username || "",
              avatar: data.avatar || "",
            };
            profiles.set(uid, nextProfile);
            missing.delete(uid);

            return { profiles, loading, missing };
          });
        })
        .catch(() => {
          set((state) => {
            const loading = new Set(state.loading);
            const missing = new Set(state.missing);
            loading.delete(uid);
            missing.add(uid);
            return { loading, missing };
          });
        })
        .finally(() => {
          profileRequests.delete(uid);
        });

      profileRequests.set(uid, request);
      return [request];
    });

    await Promise.allSettled(requests);
  },

  // ── ALTERNATIVE: Realtime listener ──────────────────────────
  // listeners: new Map(),
  //
  // subscribeToProfile: (uid) => {
  //   const { listeners } = get();
  //   if (listeners.has(uid)) return;
  //
  //   const unsub = onSnapshot(doc(db!, "users", uid), (snap) => {
  //     if (snap.exists()) {
  //       const data = snap.data();
  //       set((state) => {
  //         const newProfiles = new Map(state.profiles);
  //         newProfiles.set(uid, {
  //           username: data.username || "",
  //           avatar: data.avatar || "",
  //         });
  //         return { profiles: newProfiles };
  //       });
  //     }
  //   });
  //
  //   set((state) => {
  //     const newListeners = new Map(state.listeners);
  //     newListeners.set(uid, unsub);
  //     return { listeners: newListeners };
  //   });
  // },
  //
  // unsubscribeAll: () => {
  //   const { listeners } = get();
  //   listeners.forEach((unsub) => unsub());
  //   set({ listeners: new Map() });
  // },
}));
