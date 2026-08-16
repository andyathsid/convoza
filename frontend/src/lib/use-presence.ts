"use client";

import { useEffect, useState } from "react";
import { ref, onValue } from "firebase/database";
import { rtdb } from "@/lib/firebase";

// Listens to all users' online status from RTDB /status/
export function usePresenceMap() {
  const [presenceMap, setPresenceMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
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
      setPresenceMap(map);
    });

    return unsub;
  }, []);

  return presenceMap;
}
