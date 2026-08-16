// frontend/src/stores/slices/types.ts
import type { Timestamp } from "firebase/firestore";
import type { Chat, ChatListFilter, FirestoreMessage, CreateChatInput, SendMessageInput } from "@/types/chat";
import type { User } from "@/types/user";

export interface CachedSnapshot {
  messages: FirestoreMessage[];
  oldestMessageCursor: Timestamp | null;
  newestMessageCursor: Timestamp | null;
  hasMoreMessages: boolean;
  hasNewerMessages: boolean;
}

export interface ChatState {
  // Typing
  typingByChat: Record<string, string[]>;
  typingUnsubscribes: Map<string, () => void>;
  syncTypingListeners: (chatIds: string[]) => void;
  stopListeningTyping: () => void;
  signalTyping: (chatId: string, userId: string) => void;
  stopTyping: () => void;

  // Presence
  presenceMap: Record<string, boolean>;
  listenPresence: () => void;
  stopListeningPresence: () => void;

  // Chat list
  chats: Chat[];
  activeChat: Chat | null;
  currentChat: Chat | null;
  activeChatFilter: ChatListFilter;
  unreadChatCount: number;
  isChatsLoading: boolean;
  hasMoreChats: boolean;
  isLoadingMoreChats: boolean;
  lastChatCursor: any;
  searchChatMetadata: Map<string, { groupName: string; groupAvatar: string }>;
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

  // Messages
  messages: FirestoreMessage[];
  pendingMessages: FirestoreMessage[];
  isMessagesLoading: boolean;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: boolean;
  hasNewerMessages: boolean;
  isLoadingNewerMessages: boolean;
  isJumpingToMessage: boolean;
  isSending: boolean;
  messageUnsubscribe: (() => void) | null;
  chatsUnsubscribe: (() => void) | null;
  unreadCountUnsubscribe: (() => void) | null;
  presenceUnsubscribe: (() => void) | null;
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

  // Send
  sendMessage: (req: SendMessageInput) => Promise<void>;
  sendMediaBatch: (chatId: string, files: Array<{ file: File; mediaType: "image" | "video" | "audio" | "document"; caption?: string }>, replyToId?: string) => Promise<void>;
  retryMessage: (pendingId: string) => Promise<void>;
  removePendingMessage: (pendingId: string) => void;
  deleteMessage: (chatId: string, messageId: string) => Promise<void>;

  // Group member management
  addGroupMembers: (chatId: string, userIds: string[]) => Promise<void>;
  removeGroupMember: (chatId: string, userId: string) => Promise<void>;
  promoteGroupMember: (chatId: string, userId: string) => Promise<void>;
  demoteGroupMember: (chatId: string, userId: string) => Promise<void>;
  leaveGroup: (chatId: string) => Promise<void>;
  renameGroup: (chatId: string, groupName: string) => Promise<void>;
  updateGroupAvatar: (chatId: string, avatar: File) => Promise<void>;
}
