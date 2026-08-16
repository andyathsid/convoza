// frontend/src/stores/slices/messages-slice.ts
import type { StateCreator } from "zustand";
import type { ChatState, CachedSnapshot } from "./types";
import type { FirestoreMessage } from "@/types/chat";
import { db, auth, markMessagesDelivered, markMessagesAsRead } from "@/lib/firebase";
import {
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { api } from "@/lib/api";

// ── TUNING ── Max chat rooms kept in hot cache
const MAX_HOT_CACHE = 10;
const PAGE_SIZE = 50;

// Flag: set after jumpToMessage completes, cleared after first snapshot processes it
let jumpJustCompleted = false;

function evictOldestCacheEntry(cache: Map<string, CachedSnapshot>): Map<string, CachedSnapshot> {
  if (cache.size > MAX_HOT_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  return cache;
}

export interface MessagesSlice {
  messages: FirestoreMessage[];
  pendingMessages: FirestoreMessage[];
  isMessagesLoading: boolean;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: boolean;
  hasNewerMessages: boolean;
  isLoadingNewerMessages: boolean;
  isJumpingToMessage: boolean;
  messageUnsubscribe: (() => void) | null;
  messageCache: Map<string, CachedSnapshot>;
  currentChatId: string | null;
  sessionSentMessageIds: Set<string>;
  unseenCounts: Map<string, number>;
  lastSnapshotTimestamps: Map<string, number>;
  listenToMessages: (chatId: string) => void;
  markChatAsRead: (chatId: string) => void;
  loadMoreMessages: (chatId: string) => Promise<void>;
  loadNewerMessages: (chatId: string) => Promise<void>;
  jumpToMessage: (chatId: string, messageId: string) => Promise<number | null>;
  jumpToLatestMessage: (chatId: string) => void;
  stopListening: () => void;
  resetUnseenCount: (chatId: string) => void;
}

export const createMessagesSlice: StateCreator<
  ChatState,
  [],
  [],
  MessagesSlice
> = (set, get) => ({
  messages: [],
  pendingMessages: [],
  isMessagesLoading: false,
  isLoadingMoreMessages: false,
  hasMoreMessages: true,
  hasNewerMessages: false,
  isLoadingNewerMessages: false,
  isJumpingToMessage: false,
  messageUnsubscribe: null,
  messageCache: new Map(),
  currentChatId: null,
  sessionSentMessageIds: new Set(),
  unseenCounts: new Map(),
  lastSnapshotTimestamps: new Map(),

  markChatAsRead: (chatId: string) => {
    const currentUserId = auth?.currentUser?.uid;
    if (!currentUserId) return;

    const messages = get().messageCache.get(chatId)?.messages || [];
    const unread = messages.filter(
      (m) => m.id && m.senderId !== currentUserId && !m.readBy?.[currentUserId]
    );

    const ids = unread.map((m) => m.id!).filter(Boolean);
    const chat = get().chats.find((item) => item.id === chatId);
    const readThroughMessageId = chat?.latestUnreadMessageId || chat?.lastMessage?.id;
    if (ids.length === 0 && !readThroughMessageId) return;
    void markMessagesAsRead(chatId, ids, currentUserId, readThroughMessageId).then((didMarkRead) => {
      if (didMarkRead) get().clearChatUnread(chatId);
    });
  },

  listenToMessages: (chatId) => {
    const prev = get().messageUnsubscribe;
    if (prev) prev();

    if (!db) {
      set({ isMessagesLoading: false });
      return;
    }

    // Check in-memory cache first
    const cache = get().messageCache.get(chatId);
    if (cache) {
      console.log(`[Optimization] Cache RESTORE for chat ${chatId}: ${cache.messages.length} messages, hasMore=${cache.hasMoreMessages}`);
      set({
        messages: cache.messages,
        hasMoreMessages: cache.hasMoreMessages,
        hasNewerMessages: cache.hasNewerMessages,
        isMessagesLoading: false,
        currentChatId: chatId,
      });
    } else {
      console.log(`[Optimization] Cache MISS for chat ${chatId}, fetching from Firestore...`);
      set({ isMessagesLoading: true, currentChatId: chatId });
    }

    // Query last PAGE_SIZE messages (descending) for real-time tail
    const q = query(
      collection(db, "chats", chatId, "messages"),
      orderBy("createdAt", "desc"),
      limit(PAGE_SIZE)
    );

    // If cache HIT, first snapshot should merge (not overwrite) cached data
    let isFirstSnapshot = !cache;

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const isFromCache = snapshot.metadata.fromCache;
      const hasPendingWrites = snapshot.metadata.hasPendingWrites;
      const currentUserId = auth?.currentUser?.uid;

      const descMessages: FirestoreMessage[] = [];
      snapshot.forEach((doc) => {
        descMessages.push({ id: doc.id, ...doc.data() } as FirestoreMessage);
      });

      // Reverse to chronological order
      const latestMessages = descMessages.reverse();

      console.log(`[onSnapshot] chat ${chatId}: ${latestMessages.length} msgs, fromCache=${isFromCache}, hasPendingWrites=${hasPendingWrites}, isFirstSnapshot=${isFirstSnapshot}`);

      const lastTs = get().lastSnapshotTimestamps.get(chatId) ?? 0;
      let added = 0;
      let maxTs = lastTs;

      for (const m of latestMessages) {
        const t = (m.createdAt as Timestamp)?.toDate?.().getTime() ?? 0;
        if (t > lastTs && m.senderId !== currentUserId) added++;
        if (t > maxTs) maxTs = t;
      }

      if (!isFromCache && currentUserId && maxTs > lastTs) {
        void get().refreshChat(chatId, currentUserId);
      }

      if (!isFirstSnapshot && added > 0) {
        const next = new Map(get().unseenCounts);
        next.set(chatId, (next.get(chatId) ?? 0) + added);
        set({ unseenCounts: next });
      }

      if (maxTs > lastTs) {
        const nextTs = new Map(get().lastSnapshotTimestamps);
        nextTs.set(chatId, maxTs);
        set({ lastSnapshotTimestamps: nextTs });
      }

      // Determine cursor for loading older messages
      const hasMore = descMessages.length >= PAGE_SIZE;
      const oldestDoc = descMessages.length > 0 ? descMessages[0] : null;
      const cursor = oldestDoc?.createdAt as Timestamp | null;

      // On first snapshot, these are the initial messages.
      // On subsequent snapshots, merge with any previously loaded older messages.
      const existingMessages = isFirstSnapshot ? [] : get().messages;
      let merged: FirestoreMessage[];
      let gapDetected = false;
      let mergeSkipped = false;
      let preservedNewerCount = 0;
      let hasGapToNewer = false;
      const wasJumpJustCompleted = jumpJustCompleted;

      if (isFirstSnapshot || existingMessages.length === 0) {
        merged = latestMessages;
        console.log(`[onSnapshot] chat ${chatId}: ${latestMessages.length} messages (fresh load), hasMore=${hasMore}`);
      } else if (latestMessages.length > 0) {
        if (wasJumpJustCompleted) {
          merged = existingMessages;
          console.log(`[onSnapshot] chat ${chatId}: jump just completed, keeping ${existingMessages.length} jump messages, ignoring snapshot`);
        } else {
          const newestSnapId = latestMessages[latestMessages.length - 1].id;
          const existingIdSet = new Set(existingMessages.map((m) => m.id));

          if (existingIdSet.has(newestSnapId)) {
            // Snapshot fully contained in existing — receipt-only update
            const snapById = new Map<string, FirestoreMessage>();
            for (const m of latestMessages) {
              if (m.id) snapById.set(m.id, m);
            }

            let receiptUpdated = false;
            merged = existingMessages.map((existing) => {
              const snap = existing.id ? snapById.get(existing.id) : undefined;
              if (!snap) return existing;
              const newDeliveredTo = snap.deliveredTo;
              const newReadBy = snap.readBy;
              const deliveredChanged = JSON.stringify(newDeliveredTo) !== JSON.stringify(existing.deliveredTo);
              const readChanged = JSON.stringify(newReadBy) !== JSON.stringify(existing.readBy);
              if (deliveredChanged || readChanged) {
                receiptUpdated = true;
                return { ...existing, deliveredTo: newDeliveredTo, readBy: newReadBy };
              }
              return existing;
            });

            if (receiptUpdated) {
              console.log(`[Optimization] onSnapshot chat ${chatId}: dedup skip but receipt fields updated`);
            } else {
              console.log(`[Optimization] onSnapshot chat ${chatId}: snapshot data already in messages, skipping merge`);
            }
            mergeSkipped = true;
          } else {
            // Snapshot extends beyond our loaded range — merge needed
            const oldestNewTimestamp = latestMessages.length > 0
              ? ((latestMessages[0].createdAt as any)?.toDate?.() ?? new Date(latestMessages[0].createdAt as any)).getTime()
              : Infinity;

            const newestNewTimestamp = latestMessages.length > 0
              ? ((latestMessages[latestMessages.length - 1].createdAt as any)?.toDate?.() ?? new Date(latestMessages[latestMessages.length - 1].createdAt as any)).getTime()
              : 0;

            const newestExistingTimestamp = existingMessages.length > 0
              ? existingMessages.reduce((max, m) => {
                  const mTime = (m.createdAt as any)?.toDate?.() ? (m.createdAt as any).toDate().getTime() : new Date(m.createdAt as any).getTime();
                  return mTime > max ? mTime : max;
                }, 0)
              : 0;

            const hasGap = newestExistingTimestamp > 0 && oldestNewTimestamp > newestExistingTimestamp;

            if (hasGap) {
              // Snapshot is entirely newer than existing — gap between them.
              // Don't merge (would create missing range). Let user loadNewer to fill.
              hasGapToNewer = true;
              merged = existingMessages;
              mergeSkipped = true;
              console.log(`[onSnapshot] chat ${chatId}: GAP-TO-NEWER — snapshot range (${latestMessages.length} msgs) entirely newer than existing (${existingMessages.length} msgs, newest=${newestExistingTimestamp}). Keeping existing, hasNewer=true.`);
            } else {
              const olderMessages = existingMessages.filter((m) => {
                const mTime = (m.createdAt as any)?.toDate?.() ? (m.createdAt as any).toDate().getTime() : new Date(m.createdAt as any).getTime();
                return mTime < oldestNewTimestamp;
              });

              const newerMessages = existingMessages.filter((m) => {
                const mTime = (m.createdAt as any)?.toDate?.() ? (m.createdAt as any).toDate().getTime() : new Date(m.createdAt as any).getTime();
                return mTime > newestNewTimestamp;
              });

              const seenIds = new Set(latestMessages.map((m) => m.id));
              const uniqueOlder = olderMessages.filter((m) => !seenIds.has(m.id));
              const uniqueNewer = newerMessages.filter((m) => !seenIds.has(m.id));
              preservedNewerCount = uniqueNewer.length;

              gapDetected = uniqueOlder.length > 0;

              merged = [...uniqueOlder, ...latestMessages, ...uniqueNewer];
              console.log(`[onSnapshot] chat ${chatId}: merged — ${uniqueOlder.length} older + ${latestMessages.length} snap + ${uniqueNewer.length} newer = ${merged.length} total`);
            }
          }
        }
      } else {
        merged = existingMessages;
        console.log(`[Optimization] onSnapshot chat ${chatId}: 0 messages from snapshot, keeping ${existingMessages.length} existing`);
      }

      // Reconcile: remove pending messages that now exist in Firestore.
      const pending = get().pendingMessages;
      const reconciled = isFromCache ? pending : pending.filter((pm) => {
        if (pm.status === "failed") return true;
        return !merged.some((m) => {
          if (m.senderId !== pm.senderId) return false;
          // Match by groupId + groupIndex (new model)
          if (pm.groupId && m.groupId === pm.groupId && m.groupIndex === pm.groupIndex) return true;
          // Fallback: time proximity + content match
          const mTime = (m.createdAt as any)?.toDate?.() ? (m.createdAt as any).toDate().getTime() : new Date(m.createdAt as any).getTime();
          const pmTime = new Date(pm.createdAt as any).getTime();
          const timeDiff = Math.abs(mTime - pmTime);
          if (timeDiff >= 30000) return false;
          if (m.content === pm.content && m.mediaUrl === pm.mediaUrl) return true;
          return false;
        });
      });

      if (pending.length !== reconciled.length) {
        console.log(`[Reconcile] Removed ${pending.length - reconciled.length} pending messages (${pending.length} -> ${reconciled.length})`);
      }

      // Preserve cache's hasMore=false -- snapshot returning PAGE_SIZE docs doesn't mean
      // there are more beyond what we already loaded via loadMore.
      const cachedHasMore = get().messageCache.get(chatId)?.hasMoreMessages;
      let effectiveHasMore = cachedHasMore === false ? false : hasMore;

      // Gap detection: cache said no more messages, but snapshot returned a full page
      // AND there are cached messages older than snapshot -> gap exists, user must be able to load it
      if (cachedHasMore === false && hasMore && gapDetected) {
        effectiveHasMore = true;
        console.log(`[Optimization] Gap fix for chat ${chatId}: cache had hasMore=false but snapshot returned ${latestMessages.length} messages with older cache beyond window. Forcing hasMore=true so gap is loadable.`);
      }

      const shouldUpdateMessages = isFirstSnapshot || !isFromCache || wasJumpJustCompleted;

      // Clear the jump flag after snapshot processes it
      if (wasJumpJustCompleted) {
        jumpJustCompleted = false;
      }

      console.log(`[IndexedDB] onSnapshot chat ${chatId}: shouldUpdateMessages=${shouldUpdateMessages}, merged=${merged.length}, pending=${reconciled.length}, hasMore=${effectiveHasMore}`);

      // Compute newest cursor from the merged message list
      const newestMsg = merged.length > 0 ? merged[merged.length - 1] : null;
      const newestCursor = newestMsg?.createdAt as Timestamp | null;

      const cachedHasNewer = get().messageCache.get(chatId)?.hasNewerMessages;

      let effectiveHasNewer: boolean;
      if (wasJumpJustCompleted) {
        effectiveHasNewer = cachedHasNewer ?? false;
      } else if (hasGapToNewer) {
        effectiveHasNewer = true;
      } else if (preservedNewerCount > 0) {
        effectiveHasNewer = true;
      } else if (cachedHasNewer === true && merged.length > 0) {
        const mergedNewestTime = (newestMsg?.createdAt as any)?.toDate?.() ? newestMsg?.createdAt.toDate().getTime() : new Date(newestMsg?.createdAt as any).getTime();
        const snapNewestTime = latestMessages.length > 0
          ? ((latestMessages[latestMessages.length - 1].createdAt as any)?.toDate?.() ?? new Date(latestMessages[latestMessages.length - 1].createdAt as any)).getTime()
          : 0;
        effectiveHasNewer = mergedNewestTime > snapNewestTime ? true : false;
      } else {
        effectiveHasNewer = false;
      }

      // Update in-memory cache
      const newCache = new Map(get().messageCache);
      newCache.set(chatId, {
        messages: merged,
        oldestMessageCursor: cursor,
        newestMessageCursor: newestCursor,
        hasMoreMessages: effectiveHasMore,
        hasNewerMessages: effectiveHasNewer,
      });
      evictOldestCacheEntry(newCache);

      console.log(`[onSnapshot] chat ${chatId}: SET hasMore=${effectiveHasMore}, hasNewer=${effectiveHasNewer}, wasJump=${wasJumpJustCompleted}, preservedNewer=${preservedNewerCount}, hasGapToNewer=${hasGapToNewer}, gapDetected=${gapDetected}, mergeSkipped=${mergeSkipped}, cachedHasNewer=${cachedHasNewer}`);

      set({
        ...(shouldUpdateMessages ? { messages: merged } : {}),
        pendingMessages: reconciled,
        hasMoreMessages: effectiveHasMore,
        hasNewerMessages: effectiveHasNewer,
        isMessagesLoading: false,
        messageCache: newCache,
      });

      // Read receipts: mark messages from others as delivered
      if (currentUserId && shouldUpdateMessages && !mergeSkipped) {
        const undelivered = merged.filter(
          (m) => m.senderId !== currentUserId && !m.deliveredTo?.[currentUserId]
        );
        if (undelivered.length > 0) {
          markMessagesDelivered(chatId, undelivered.map((m) => m.id!).filter(Boolean), currentUserId);
        }

        // If this chat is currently active/focused, also mark as read
        if (get().currentChatId === chatId) {
          const unread = merged.filter(
            (m) => m.senderId !== currentUserId && !m.readBy?.[currentUserId]
          );
          if (unread.length > 0) {
            const ids = unread.map((m) => m.id!).filter(Boolean);
            const readThroughMessageId = unread.at(-1)?.id;
            void markMessagesAsRead(chatId, ids, currentUserId, readThroughMessageId).then((didMarkRead) => {
              if (didMarkRead) get().clearChatUnread(chatId);
            });
          }
        }
      }

      isFirstSnapshot = false;
    }, (error) => {
      console.error("Failed to listen to messages:", error);
      set({ isMessagesLoading: false });
    });

    set({ messageUnsubscribe: unsubscribe });
  },

  loadMoreMessages: async (chatId) => {
    const state = get();
    if (state.isLoadingMoreMessages || !state.hasMoreMessages || !db) return;

    const cache = state.messageCache.get(chatId);
    if (!cache?.oldestMessageCursor) {
      set({ hasMoreMessages: false });
      return;
    }

    set({ isLoadingMoreMessages: true });

    try {
      const q = query(
        collection(db, "chats", chatId, "messages"),
        orderBy("createdAt", "desc"),
        startAfter(cache.oldestMessageCursor),
        limit(PAGE_SIZE)
      );

      const snapshot = await getDocs(q);
      const descDocs: FirestoreMessage[] = [];
      snapshot.forEach((doc) => {
        descDocs.push({ id: doc.id, ...doc.data() } as FirestoreMessage);
      });

      const olderMessages = descDocs.reverse();
      const hasMore = descDocs.length >= PAGE_SIZE;

      // Prepend older messages, deduplicate by ID
      const existingMessages = get().messages;
      const seenIds = new Set(existingMessages.map((m) => m.id));
      const uniqueOlder = olderMessages.filter((m) => !seenIds.has(m.id));
      const merged = [...uniqueOlder, ...existingMessages];

      // Update cursor
      const oldestDoc = descDocs.length > 0 ? descDocs[0] : null;
      const newCursor = oldestDoc?.createdAt as Timestamp | null;

      // Update cache
      const currentCache = get().messageCache.get(chatId);
      const newestMsg = merged.length > 0 ? merged[merged.length - 1] : null;
      const newCache = new Map(get().messageCache);
      newCache.set(chatId, {
        messages: merged,
        oldestMessageCursor: newCursor,
        newestMessageCursor: currentCache?.newestMessageCursor ?? (newestMsg?.createdAt as Timestamp | null),
        hasMoreMessages: hasMore,
        hasNewerMessages: currentCache?.hasNewerMessages ?? false,
      });
      evictOldestCacheEntry(newCache);

      console.log(`[Optimization] loadMoreMessages done: fetched ${olderMessages.length} older, ${uniqueOlder.length} unique, ${merged.length} total, hasMore=${hasMore}`);

      set({
        messages: merged,
        hasMoreMessages: hasMore,
        isLoadingMoreMessages: false,
        messageCache: newCache,
      });
    } catch (err) {
      console.error("Failed to load more messages:", err);
      set({ isLoadingMoreMessages: false });
    }
  },

  loadNewerMessages: async (chatId) => {
    const state = get();
    console.log(`[loadNewerMessages] chat ${chatId}: guard check — isLoadingNewer=${state.isLoadingNewerMessages}, hasNewer=${state.hasNewerMessages}, db=${!!db}`);
    if (state.isLoadingNewerMessages || !state.hasNewerMessages || !db) {
      console.log(`[loadNewerMessages] chat ${chatId}: GUARDED — skipping`);
      return;
    }

    const cache = state.messageCache.get(chatId);
    if (!cache?.newestMessageCursor) {
      console.log(`[loadNewerMessages] chat ${chatId}: no cursor — setting hasNewer=false`);
      set({ hasNewerMessages: false });
      return;
    }

    console.log(`[loadNewerMessages] chat ${chatId}: FETCHING newer after cursor=${cache.newestMessageCursor}`);
    set({ isLoadingNewerMessages: true });

    try {
      const q = query(
        collection(db, "chats", chatId, "messages"),
        orderBy("createdAt", "asc"),
        startAfter(cache.newestMessageCursor),
        limit(PAGE_SIZE)
      );

      const snapshot = await getDocs(q);
      const newerMessages: FirestoreMessage[] = [];
      snapshot.forEach((doc) => {
        newerMessages.push({ id: doc.id, ...doc.data() } as FirestoreMessage);
      });

      const hasMore = snapshot.docs.length >= PAGE_SIZE;

      // Append newer messages, deduplicate by ID
      const existingMessages = get().messages;
      const seenIds = new Set(existingMessages.map((m) => m.id));
      const uniqueNewer = newerMessages.filter((m) => !seenIds.has(m.id));
      const merged = [...existingMessages, ...uniqueNewer];

      // Update newest cursor
      const newestDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
      const newCursor = newestDoc?.data()?.createdAt as Timestamp | null;

      // Update cache
      const currentCache = get().messageCache.get(chatId);
      const newCache = new Map(get().messageCache);
      newCache.set(chatId, {
        messages: merged,
        oldestMessageCursor: currentCache?.oldestMessageCursor ?? null,
        newestMessageCursor: newCursor,
        hasMoreMessages: currentCache?.hasMoreMessages ?? false,
        hasNewerMessages: hasMore,
      });
      evictOldestCacheEntry(newCache);

      console.log(`[Optimization] loadNewerMessages done: fetched ${newerMessages.length} newer, ${uniqueNewer.length} unique, ${merged.length} total, hasMore=${hasMore}`);

      set({
        messages: merged,
        hasNewerMessages: hasMore,
        isLoadingNewerMessages: false,
        messageCache: newCache,
      });
    } catch (err) {
      console.error("Failed to load newer messages:", err);
      set({ isLoadingNewerMessages: false });
    }
  },

  jumpToMessage: async (chatId, messageId) => {
    const state = get();

    // Check if target is already in loaded messages
    const existingIdx = state.messages.findIndex((m) => m.id === messageId);
    if (existingIdx >= 0) {
      set({ isJumpingToMessage: false });
      return existingIdx;
    }

    // Abort current snapshot listener to prevent race
    if (state.messageUnsubscribe) {
      state.messageUnsubscribe();
    }

    set({ isJumpingToMessage: true });

    try {
      if (!db) return null;

      // Fetch target message doc directly
      const targetSnap = await getDoc(doc(db, "chats", chatId, "messages", messageId));
      if (!targetSnap.exists()) {
        console.warn(`[jumpToMessage] Target doc ${messageId} does not exist in Firestore`);
        set({ isJumpingToMessage: false });
        return null;
      }

      const targetMsg = { id: targetSnap.id, ...targetSnap.data() } as FirestoreMessage;
      const targetCreatedAt = targetMsg.createdAt;

      // Fetch older messages (before target)
      const halfPage = Math.floor(PAGE_SIZE / 2);
      const olderQuery = query(
        collection(db, "chats", chatId, "messages"),
        orderBy("createdAt", "desc"),
        startAfter(targetCreatedAt),
        limit(halfPage)
      );
      const olderSnap = await getDocs(olderQuery);
      const olderDocs: FirestoreMessage[] = [];
      olderSnap.forEach((doc) => {
        olderDocs.push({ id: doc.id, ...doc.data() } as FirestoreMessage);
      });
      olderDocs.reverse(); // chronological order

      // Fetch newer messages (after target)
      const newerQuery = query(
        collection(db, "chats", chatId, "messages"),
        orderBy("createdAt", "asc"),
        startAfter(targetCreatedAt),
        limit(halfPage)
      );
      const newerSnap = await getDocs(newerQuery);
      const newerDocs: FirestoreMessage[] = [];
      newerSnap.forEach((doc) => {
        newerDocs.push({ id: doc.id, ...doc.data() } as FirestoreMessage);
      });

      // Merge deduplicated: older + target + newer
      const seenIds = new Set<string>();
      const merged: FirestoreMessage[] = [];
      for (const m of [...olderDocs, targetMsg, ...newerDocs]) {
        if (m.id && !seenIds.has(m.id)) {
          seenIds.add(m.id);
          merged.push(m);
        }
      }

      const oldestCursor = olderDocs.length > 0 ? (olderDocs[0].createdAt as Timestamp) : null;
      const newestCursor = newerDocs.length > 0 ? (newerDocs[newerDocs.length - 1].createdAt as Timestamp) : null;
      const hasMore = olderSnap.docs.length >= halfPage;
      const hasNewer = newerSnap.docs.length >= halfPage;

      // Update cache with jump data
      const newCache = new Map(get().messageCache);
      newCache.set(chatId, {
        messages: merged,
        oldestMessageCursor: oldestCursor,
        newestMessageCursor: newestCursor,
        hasMoreMessages: hasMore,
        hasNewerMessages: hasNewer,
      });
      evictOldestCacheEntry(newCache);

      set({
        messages: merged,
        hasMoreMessages: hasMore,
        hasNewerMessages: hasNewer,
        messageCache: newCache,
        isJumpingToMessage: false,
      });

      const resultIdx = merged.findIndex((m) => m.id === messageId);
      console.log(`[jumpToMessage] Done: ${merged.length} msgs, targetIdx=${resultIdx}, hasMore=${hasMore}, hasNewer=${hasNewer}`);

      // Mark jump completed so the next snapshot updates the component
      jumpJustCompleted = true;

      // Re-establish real-time listener (will find cache → isFirstSnapshot = false → merge)
      get().listenToMessages(chatId);

      return resultIdx;
    } catch (err) {
      console.error("Failed to jump to message:", err);
      set({ isJumpingToMessage: false });
      return null;
    }
  },

  stopListening: () => {
    const { messageUnsubscribe: unsub, currentChatId, messages, messageCache } = get();
    if (unsub) unsub();

    // Save current messages to cache before clearing state
    if (currentChatId && messages.length > 0) {
      const existing = messageCache.get(currentChatId);
      const newestMsg = messages.length > 0 ? messages[messages.length - 1] : null;
      const newCache = new Map(messageCache);
      newCache.set(currentChatId, {
        messages,
        oldestMessageCursor: existing?.oldestMessageCursor || null,
        newestMessageCursor: existing?.newestMessageCursor ?? (newestMsg?.createdAt as Timestamp | null),
        hasMoreMessages: existing?.hasMoreMessages ?? false,
        hasNewerMessages: existing?.hasNewerMessages ?? false,
      });
      evictOldestCacheEntry(newCache);
      console.log(`[Optimization] Cache SAVE for chat ${currentChatId}: ${messages.length} messages`);
      set({ messageCache: newCache });
    }

    set({
      messageUnsubscribe: null,
      messages: [],
      pendingMessages: [],
      currentChatId: null,
      sessionSentMessageIds: new Set(),
    });
  },

  resetUnseenCount: (chatId: string) => {
    const next = new Map(get().unseenCounts);
    if (next.has(chatId)) {
      next.set(chatId, 0);
      set({ unseenCounts: next });
    }
  },

  jumpToLatestMessage: (chatId: string) => {
    const { messageUnsubscribe: unsub } = get();
    if (unsub) unsub();

    // Invalidate cache so listenToMessages starts fresh (isFirstSnapshot = true)
    const newCache = new Map(get().messageCache);
    newCache.delete(chatId);

    set({
      messages: [],
      hasMoreMessages: true,
      hasNewerMessages: false,
      isLoadingNewerMessages: false,
      isMessagesLoading: true,
      messageCache: newCache,
    });

    // Re-establish listener — cache miss → fresh PAGE_SIZE query → replaces messages
    get().listenToMessages(chatId);
  },
});
