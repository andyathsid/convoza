import type { StateCreator } from "zustand";
import type { ChatState } from "./types";
import type { Chat, ChatListFilter, CreateChatInput } from "@/types/chat";
import type { User } from "@/types/user";
import { api, groupApi } from "@/lib/api";
import { db } from "@/lib/firebase";
import {
  collection,
  collectionGroup,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Timestamp,
} from "firebase/firestore";
import { useUIStore } from "../ui-store";
import { useProfiles } from "../use-profiles";

const CHAT_PAGE_SIZE = 20;

type ChatCursor = QueryDocumentSnapshot<DocumentData> | null;

export interface ChatListSlice {
  chats: Chat[];
  activeChat: Chat | null;
  currentChat: Chat | null;
  activeChatFilter: ChatListFilter;
  unreadChatCount: number;
  isChatsLoading: boolean;
  hasMoreChats: boolean;
  isLoadingMoreChats: boolean;
  lastChatCursor: ChatCursor;
  chatsUnsubscribe: (() => void) | null;
  unreadCountUnsubscribe: (() => void) | null;
  searchChatMetadata: Map<string, SearchChatMetadata>;
  ensureSearchChatMetadata: (chatIds: string[]) => Promise<void>;
  listenToChats: (currentUserId: string) => void;
  loadChats: (currentUserId: string, filter?: ChatListFilter) => Promise<void>;
  setChatFilter: (filter: ChatListFilter, currentUserId: string) => void;
  refreshChat: (chatId: string, currentUserId: string) => Promise<void>;
  refreshUnreadChatCount: (currentUserId: string) => Promise<void>;
  clearChatUnread: (chatId: string) => void;
  stopListeningChats: () => void;
  loadMoreChats: (currentUserId: string) => Promise<void>;
  createChat: (req: CreateChatInput) => Promise<Chat | null>;
  setActiveChat: (chatOrId: Chat | string) => void;
  updateActiveChat: (chat: Chat) => void;
  searchUsers: (query: string) => Promise<User[]>;
  getAllUsers: () => Promise<User[]>;
  addGroupMembers: (chatId: string, userIds: string[]) => Promise<void>;
  removeGroupMember: (chatId: string, userId: string) => Promise<void>;
  promoteGroupMember: (chatId: string, userId: string) => Promise<void>;
  demoteGroupMember: (chatId: string, userId: string) => Promise<void>;
  leaveGroup: (chatId: string) => Promise<void>;
  renameGroup: (chatId: string, groupName: string) => Promise<void>;
  updateGroupAvatar: (chatId: string, avatar: File) => Promise<void>;
}

export interface SearchChatMetadata {
  groupName: string;
  groupAvatar: string;
}

interface ChatPage {
  chats: Chat[];
  cursor: ChatCursor;
  hasMore: boolean;
}

function mapChatDocument(snapshot: QueryDocumentSnapshot<DocumentData>): Chat {
  const data = snapshot.data();
  const participantIds: string[] = data.participants || [];
  const participants: User[] = participantIds.map((id) => ({
    id,
    username: "",
    email: "",
    avatar: "",
    created_at: "",
    updated_at: null,
  }));
  const lastMessage = data.lastMessage
    ? {
        id: data.lastMessage.id || undefined,
        content: data.lastMessage.content || "",
        senderId: data.lastMessage.senderId || "",
        senderName: data.lastMessage.senderName || "",
        createdAt: data.lastMessage.createdAt?.toDate?.()?.toISOString?.() || data.lastMessage.createdAt || "",
        mediaUrl: data.lastMessage.mediaUrl,
        mediaType: data.lastMessage.mediaType,
        thumbnailUrl: data.lastMessage.thumbnailUrl,
        documentName: data.lastMessage.documentName,
      }
    : null;

  return {
    id: snapshot.id,
    isGroup: data.isGroup || false,
    groupName: data.groupName || "",
    groupAvatar: data.groupAvatar || "",
    createdBy: data.createdBy || "",
    initiator: data.initiator || "",
    createdAt: (data.createdAt as Timestamp)?.toDate?.()?.toISOString?.() || data.createdAt || "",
    updatedAt: (data.updatedAt as Timestamp)?.toDate?.()?.toISOString?.() || data.updatedAt || "",
    participants,
    lastMessage,
  };
}

async function hydrateUnreadState(chats: Chat[], currentUserId: string): Promise<Chat[]> {
  if (!db || chats.length === 0) return chats;
  const members = await Promise.allSettled(
    chats.map((chat) => getDoc(doc(db!, "chats", chat.id, "members", currentUserId)))
  );
  return chats.map((chat, index) => {
    const result = members[index];
    if (result.status !== "fulfilled" || !result.value.exists()) return chat;
    const data = result.value.data();
    return {
      ...chat,
      hasUnread: data.hasUnread === true,
      unreadCount: typeof data.unreadCount === "number" ? data.unreadCount : 0,
      latestUnreadMessageId: data.latestUnreadMessageId || null,
    };
  });
}

async function fetchChatWithUnreadState(chatId: string, currentUserId: string): Promise<Chat | null> {
  if (!db) return null;
  const chatSnapshot = await getDoc(doc(db, "chats", chatId));
  if (!chatSnapshot.exists()) return null;
  const [chat] = await hydrateUnreadState([mapChatDocument(chatSnapshot)], currentUserId);
  return chat || null;
}

async function hydrateUnreadMemberChats(memberDocs: QueryDocumentSnapshot<DocumentData>[]): Promise<Chat[]> {
  if (!db || memberDocs.length === 0) return [];
  const chatSnapshots = await Promise.all(
    memberDocs.map((member) => {
      const chatId = member.data().chatId || member.ref.parent.parent?.id;
      return chatId ? getDoc(doc(db!, "chats", chatId)) : null;
    })
  );
  return chatSnapshots.flatMap((chatSnapshot, index) => {
    if (!chatSnapshot?.exists()) return [];
    const member = memberDocs[index].data();
    return [{
      ...mapChatDocument(chatSnapshot),
      hasUnread: true,
      unreadCount: typeof member.unreadCount === "number" ? member.unreadCount : 0,
      latestUnreadMessageId: member.latestUnreadMessageId || null,
    }];
  });
}

function chatUpdatedAtMs(chat: Chat): number {
  const value = chat.updatedAt || chat.lastMessage?.createdAt || chat.createdAt;
  const ms = Date.parse(value || "");
  return Number.isNaN(ms) ? 0 : ms;
}

function sortChatsByUpdatedAt(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => chatUpdatedAtMs(b) - chatUpdatedAtMs(a));
}

function canShowInFilter(chat: Chat, currentUserId: string, filter: ChatListFilter, alreadyVisible: boolean): boolean {
  const isParticipant = chat.participants.some((participant) => participant.id === currentUserId);
  const isVisibleConversation = chat.initiator === currentUserId || chat.lastMessage !== null;

  if (!isParticipant) return false;
  if (!isVisibleConversation) return alreadyVisible;
  if (filter === "groups") return chat.isGroup;
  if (filter === "unread") return chat.hasUnread === true || alreadyVisible;
  return true;
}

async function fetchChatPage(
  currentUserId: string,
  filter: ChatListFilter,
  cursor: ChatCursor,
): Promise<ChatPage> {
  if (!db) return { chats: [], cursor: null, hasMore: false };

  if (filter === "unread") {
    const constraints = [
      where("uid", "==", currentUserId),
      where("leftAt", "==", null),
      where("hasUnread", "==", true),
      orderBy("lastUnreadAt", "desc"),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(CHAT_PAGE_SIZE),
    ];
    const memberSnapshot = await getDocs(query(collectionGroup(db, "members"), ...constraints));
    const chats = await hydrateUnreadMemberChats(memberSnapshot.docs);
    return {
      chats,
      cursor: memberSnapshot.docs.at(-1) || null,
      hasMore: memberSnapshot.docs.length === CHAT_PAGE_SIZE,
    };
  }

  const constraints = [
    where("participants", "array-contains", currentUserId),
    ...(filter === "groups" ? [where("isGroup", "==", true)] : []),
    orderBy("updatedAt", "desc"),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(CHAT_PAGE_SIZE),
  ];
  const chatSnapshot = await getDocs(query(collection(db, "chats"), ...constraints));
  const mapped = chatSnapshot.docs
    .map(mapChatDocument)
    .filter((chat) => chat.initiator === currentUserId || chat.lastMessage !== null);
  const chats = await hydrateUnreadState(mapped, currentUserId);
  return {
    chats,
    cursor: chatSnapshot.docs.at(-1) || null,
    hasMore: chatSnapshot.docs.length === CHAT_PAGE_SIZE,
  };
}

async function ensureParticipantProfiles(chats: Chat[]) {
  const participantIds = [...new Set(chats.flatMap((chat) => chat.participants.map((participant) => participant.id)))];
  if (participantIds.length > 0) await useProfiles.getState().ensureProfiles(participantIds);
}

export const createChatListSlice: StateCreator<ChatState, [], [], ChatListSlice> = (set, get) => ({
  chats: [],
  activeChat: null,
  currentChat: null,
  activeChatFilter: "all",
  unreadChatCount: 0,
  isChatsLoading: true,
  hasMoreChats: true,
  isLoadingMoreChats: false,
  lastChatCursor: null,
  chatsUnsubscribe: null,
  unreadCountUnsubscribe: null,
  searchChatMetadata: new Map(),

  ensureSearchChatMetadata: async (chatIds) => {
    if (!db) return;
    const cached = new Map(get().searchChatMetadata);
    for (const chatId of chatIds) {
      const loaded = get().chats.find((chat) => chat.id === chatId);
      if (loaded) cached.set(chatId, { groupName: loaded.groupName || "", groupAvatar: loaded.groupAvatar || "" });
    }
    const missing = [...new Set(chatIds)].filter((chatId) => !cached.has(chatId));
    const snapshots = await Promise.allSettled(missing.map((chatId) => getDoc(doc(db!, "chats", chatId))));
    snapshots.forEach((result, index) => {
      if (result.status !== "fulfilled" || !result.value.exists()) return;
      const data = result.value.data();
      cached.set(missing[index], { groupName: data.groupName || "", groupAvatar: data.groupAvatar || "" });
    });
    set({ searchChatMetadata: cached });
  },

  listenToChats: (currentUserId) => {
    const previousChatsUnsubscribe = get().chatsUnsubscribe;
    if (previousChatsUnsubscribe) previousChatsUnsubscribe();

    const previousUnreadCountUnsubscribe = get().unreadCountUnsubscribe;
    if (previousUnreadCountUnsubscribe) previousUnreadCountUnsubscribe();

    if (!db) {
      set({ isChatsLoading: false, chatsUnsubscribe: null, unreadCountUnsubscribe: null });
      return;
    }

    const filter = get().activeChatFilter;
    let cancelled = false;
    set({
      chats: [],
      isChatsLoading: true,
      isLoadingMoreChats: false,
      lastChatCursor: null,
      hasMoreChats: true,
    });

    const constraints = filter === "unread"
      ? [
          where("uid", "==", currentUserId),
          where("leftAt", "==", null),
          where("hasUnread", "==", true),
          orderBy("lastUnreadAt", "desc"),
          limit(CHAT_PAGE_SIZE),
        ]
      : [
          where("participants", "array-contains", currentUserId),
          ...(filter === "groups" ? [where("isGroup", "==", true)] : []),
          orderBy("updatedAt", "desc"),
          limit(CHAT_PAGE_SIZE),
        ];
    const chatQuery = filter === "unread"
      ? query(collectionGroup(db, "members"), ...constraints)
      : query(collection(db, "chats"), ...constraints);

    const unsubscribeChats = onSnapshot(chatQuery, (snapshot) => {
      void (async () => {
        try {
          const pageChats = filter === "unread"
            ? await hydrateUnreadMemberChats(snapshot.docs)
            : await hydrateUnreadState(
                snapshot.docs
                  .map(mapChatDocument)
                  .filter((chat) => chat.initiator === currentUserId || chat.lastMessage !== null),
                currentUserId
              );

          if (cancelled || get().activeChatFilter !== filter) return;
          await ensureParticipantProfiles(pageChats);
          if (cancelled || get().activeChatFilter !== filter) return;
          set((state) => {
            const freshActiveChat = state.activeChat && pageChats.find((chat) => chat.id === state.activeChat?.id);
            const snapshotIds = new Set(pageChats.map((chat) => chat.id));
            const preservedRows = state.chats.filter((chat) => !snapshotIds.has(chat.id));
            const mergedChats = [...pageChats, ...preservedRows];
            return {
              chats: filter === "unread" ? mergedChats : sortChatsByUpdatedAt(mergedChats),
              lastChatCursor: snapshot.docs.at(-1) || null,
              hasMoreChats: snapshot.docs.length === CHAT_PAGE_SIZE,
              isChatsLoading: false,
              ...(freshActiveChat ? { activeChat: freshActiveChat, currentChat: freshActiveChat } : {}),
            };
          });
        } catch (error) {
          console.error("Failed to hydrate chat listener:", error);
          if (!cancelled) set({ isChatsLoading: false });
        }
      })();
    }, (error) => {
      console.error("Failed to listen to chats:", error);
      set({ isChatsLoading: false, hasMoreChats: false });
    });

    const unreadCountQuery = query(
      collectionGroup(db, "members"),
      where("uid", "==", currentUserId),
      where("leftAt", "==", null),
      where("hasUnread", "==", true),
      orderBy("lastUnreadAt", "desc"),
    );
    const unsubscribeUnreadCount = onSnapshot(unreadCountQuery, (snapshot) => {
      set({ unreadChatCount: snapshot.size });
    }, (error) => {
      console.error("Failed to listen to unread chat count:", error);
    });

    set({
      chatsUnsubscribe: () => {
        cancelled = true;
        unsubscribeChats();
      },
      unreadCountUnsubscribe: unsubscribeUnreadCount,
    });
  },

  loadChats: async (currentUserId, filter = get().activeChatFilter) => {
    set({ isChatsLoading: true, isLoadingMoreChats: false, lastChatCursor: null, hasMoreChats: true });
    try {
      const page = await fetchChatPage(currentUserId, filter, null);
      if (get().activeChatFilter !== filter) return;
      await ensureParticipantProfiles(page.chats);
      if (get().activeChatFilter !== filter) return;
      set((state) => {
        const freshActiveChat = state.activeChat && page.chats.find((chat) => chat.id === state.activeChat?.id);
        return {
          chats: page.chats,
          lastChatCursor: page.cursor,
          hasMoreChats: page.hasMore,
          isChatsLoading: false,
          ...(freshActiveChat ? { activeChat: freshActiveChat, currentChat: freshActiveChat } : {}),
        };
      });
      void get().refreshUnreadChatCount(currentUserId);
    } catch (error) {
      console.error("Failed to load chats:", error);
      set({ chats: [], isChatsLoading: false, hasMoreChats: false });
    }
  },

  setChatFilter: (filter, currentUserId) => {
    set({ activeChatFilter: filter });
    get().listenToChats(currentUserId);
  },

  refreshChat: async (chatId, currentUserId) => {
    try {
      const chat = await fetchChatWithUnreadState(chatId, currentUserId);
      if (!chat) return;
      await ensureParticipantProfiles([chat]);
      set((state) => {
        const alreadyVisible = state.chats.some((item) => item.id === chatId);
        const shouldShow = canShowInFilter(chat, currentUserId, state.activeChatFilter, alreadyVisible);
        const replaced = state.chats.map((item) => item.id === chatId ? chat : item);
        const nextChats = shouldShow
          ? alreadyVisible
            ? replaced
            : [chat, ...state.chats]
          : state.chats.filter((item) => item.id !== chatId);

        return {
          chats: state.activeChatFilter === "unread" ? nextChats : sortChatsByUpdatedAt(nextChats),
          activeChat: state.activeChat?.id === chatId ? { ...state.activeChat, ...chat } : state.activeChat,
          currentChat: state.currentChat?.id === chatId ? { ...state.currentChat, ...chat } : state.currentChat,
        };
      });
    } catch (error) {
      console.error("Failed to refresh chat:", error);
    }
  },

  refreshUnreadChatCount: async (currentUserId) => {
    if (!db) return;
    try {
      const unreadQuery = query(
        collectionGroup(db, "members"),
        where("uid", "==", currentUserId),
        where("leftAt", "==", null),
        where("hasUnread", "==", true),
        orderBy("lastUnreadAt", "desc"),
      );
      const snapshot = await getCountFromServer(unreadQuery);
      set({ unreadChatCount: snapshot.data().count });
    } catch (error) {
      console.error("Failed to count unread chats:", error);
    }
  },

  clearChatUnread: (chatId) => {
    set((state) => {
      const target = state.chats.find((chat) => chat.id === chatId);
      if (!target?.hasUnread) return {};
      const updated = { ...target, hasUnread: false, unreadCount: 0, latestUnreadMessageId: null };
      return {
        chats: state.chats.map((chat) => chat.id === chatId ? updated : chat),
        activeChat: state.activeChat?.id === chatId ? { ...state.activeChat, ...updated } : state.activeChat,
        currentChat: state.currentChat?.id === chatId ? { ...state.currentChat, ...updated } : state.currentChat,
        unreadChatCount: Math.max(0, state.unreadChatCount - 1),
      };
    });
  },

  stopListeningChats: () => {
    const previousChatsUnsubscribe = get().chatsUnsubscribe;
    if (previousChatsUnsubscribe) previousChatsUnsubscribe();
    const previousUnreadCountUnsubscribe = get().unreadCountUnsubscribe;
    if (previousUnreadCountUnsubscribe) previousUnreadCountUnsubscribe();
    set({
      chats: [],
      activeChatFilter: "all",
      hasMoreChats: true,
      isLoadingMoreChats: false,
      lastChatCursor: null,
      chatsUnsubscribe: null,
      unreadCountUnsubscribe: null,
    });
  },

  loadMoreChats: async (currentUserId) => {
    const state = get();
    if (!state.lastChatCursor || state.isLoadingMoreChats || !state.hasMoreChats) return;
    set({ isLoadingMoreChats: true });
    try {
      const page = await fetchChatPage(currentUserId, state.activeChatFilter, state.lastChatCursor);
      if (get().activeChatFilter !== state.activeChatFilter) return;
      await ensureParticipantProfiles(page.chats);
      if (get().activeChatFilter !== state.activeChatFilter) return;
      set((current) => {
        const ids = new Set(current.chats.map((chat) => chat.id));
        return {
          chats: [...current.chats, ...page.chats.filter((chat) => !ids.has(chat.id))],
          lastChatCursor: page.cursor,
          hasMoreChats: page.hasMore,
          isLoadingMoreChats: false,
        };
      });
    } catch (error) {
      console.error("Failed to load more chats:", error);
      set({ isLoadingMoreChats: false });
    }
  },

  createChat: async (req) => {
    try {
      const res = await api.post("/chat/create", req);
      const chat = res.chat as Chat;
      await ensureParticipantProfiles([chat]);
      set((state) => ({ chats: [{ ...chat, hasUnread: false, unreadCount: 0 }, ...state.chats.filter((item) => item.id !== chat.id)] }));
      return chat;
    } catch (error) {
      console.error("Failed to create chat:", error);
      return null;
    }
  },

  setActiveChat: (chatOrId) => {
    useUIStore.getState().setActiveChatContentPanel("none");
    const chat = typeof chatOrId === "string" ? get().chats.find((item) => item.id === chatOrId) : chatOrId;
    if (chat) set({ activeChat: chat, currentChat: chat });
    const chatId = typeof chatOrId === "string" ? chatOrId : chatOrId.id;
    get().listenToMessages(chatId);
    get().markChatAsRead(chatId);
  },

  updateActiveChat: (chat) => set({ activeChat: chat, currentChat: chat }),

  searchUsers: async (searchQuery) => {
    try { return (await api.get(`/users/search?q=${encodeURIComponent(searchQuery)}`)).users || []; }
    catch (error) { console.error("Failed to search users:", error); return []; }
  },
  getAllUsers: async () => {
    try { return (await api.get("/users")).users || []; }
    catch (error) { console.error("Failed to get all users:", error); return []; }
  },
  addGroupMembers: async (chatId, userIds) => { await groupApi.addMembers(chatId, userIds); },
  removeGroupMember: async (chatId, userId) => { await groupApi.removeMember(chatId, userId); },
  promoteGroupMember: async (chatId, userId) => { await groupApi.promoteMember(chatId, userId); },
  demoteGroupMember: async (chatId, userId) => { await groupApi.demoteMember(chatId, userId); },
  leaveGroup: async (chatId) => { await groupApi.leaveGroup(chatId); },
  renameGroup: async (chatId, groupName) => { await groupApi.renameGroup(chatId, groupName); },
  updateGroupAvatar: async (chatId, avatar) => {
    await groupApi.updateGroupAvatar(chatId, avatar);
  },
});
