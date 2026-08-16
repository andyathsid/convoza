import {
  onDisconnect,
  onValue,
  ref,
  remove,
  serverTimestamp,
  set,
  type DatabaseReference,
} from "firebase/database";
import { rtdb } from "@/lib/firebase";

export const TYPING_IDLE_MS = 2_000;

let sessionId: string | null = null;
let activeRef: DatabaseReference | null = null;
let activePath: string | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let operationId = 0;

function getSessionId(): string {
  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }
  return sessionId;
}

function clearIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

export function signalTyping(chatId: string, userId: string): void {
  if (!rtdb || !chatId || !userId) return;

  clearIdleTimer();

  const path = `/typing/${chatId}/${userId}/${getSessionId()}`;
  if (activePath === path) {
    idleTimer = setTimeout(stopTyping, TYPING_IDLE_MS);
    return;
  }

  stopTyping();
  const typingRef = ref(rtdb, path);
  const currentOperation = ++operationId;
  activePath = path;
  activeRef = typingRef;

  void onDisconnect(typingRef)
    .remove()
    .then(() => {
      if (currentOperation !== operationId || activePath !== path) return;
      return set(typingRef, serverTimestamp());
    })
    .catch(() => {
      if (currentOperation === operationId) {
        activePath = null;
        activeRef = null;
      }
    });

  idleTimer = setTimeout(stopTyping, TYPING_IDLE_MS);
}

export function stopTyping(): void {
  clearIdleTimer();
  operationId += 1;

  const typingRef = activeRef;
  activeRef = null;
  activePath = null;

  if (!typingRef) return;
  void onDisconnect(typingRef).cancel().catch(() => {});
  void remove(typingRef).catch(() => {});
}

export function subscribeToTyping(
  chatId: string,
  onChange: (userIds: string[]) => void,
): () => void {
  if (!rtdb || !chatId) {
    onChange([]);
    return () => {};
  }

  const typingRef = ref(rtdb, `/typing/${chatId}`);
  return onValue(
    typingRef,
    (snapshot) => {
      const data = snapshot.val() as Record<string, Record<string, number>> | null;
      const userIds = data
        ? Object.entries(data)
            .filter(([, sessions]) => sessions && Object.keys(sessions).length > 0)
            .sort(([, left], [, right]) => {
              const leftStartedAt = Math.min(...Object.values(left));
              const rightStartedAt = Math.min(...Object.values(right));
              return leftStartedAt - rightStartedAt;
            })
            .map(([userId]) => userId)
        : [];
      onChange(userIds);
    },
    () => onChange([]),
  );
}

export function formatTypingText(
  names: string[],
  options: { compactDirect?: boolean } = {},
): string {
  if (names.length === 0) return "";
  if (options.compactDirect && names.length === 1) return "typing...";
  if (names.length > 3) return "Several people are typing...";
  if (names.length === 1) return `${names[0]} is typing...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
  return `${names[0]}, ${names[1]}, and ${names[2]} are typing...`;
}
