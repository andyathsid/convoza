import { create } from "zustand";
import type { FirestoreMessage } from "@/features/chat/types/chat";

type ChatListPanel = "chatList" | "newChat";
type ChatContentPanel = "none" | "info" | "groupInfo" | "search";

export interface InChatMessageFilter {
  chatId: string;
  query: string;
  fromMs?: number;
  toMs?: number;
}

interface UIState {
  isMobileSidebarOpen: boolean;
  activeChatListPanel: ChatListPanel;
  activeChatContentPanel: ChatContentPanel;
  searchOrigin: ChatContentPanel;
  replyTo: FirestoreMessage | null;
  searchJumpTargetId: string | null;
  inChatMessageFilter: InChatMessageFilter | null;
  toggleMobileSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setActiveChatListPanel: (panel: ChatListPanel) => void;
  setActiveChatContentPanel: (panel: ChatContentPanel, origin?: ChatContentPanel) => void;
  closeAllPanels: () => void;
  setReplyTo: (msg: FirestoreMessage | null) => void;
  setSearchJumpTargetId: (id: string | null) => void;
  setInChatMessageFilter: (filter: InChatMessageFilter | null) => void;
  clearInChatMessageFilter: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  isMobileSidebarOpen: false,
  activeChatListPanel: "chatList",
  activeChatContentPanel: "none",
  searchOrigin: "none",
  replyTo: null,
  searchJumpTargetId: null,
  inChatMessageFilter: null,
  toggleMobileSidebar: () =>
    set((state) => ({ isMobileSidebarOpen: !state.isMobileSidebarOpen })),
  setMobileSidebarOpen: (open) => set({ isMobileSidebarOpen: open }),
  setActiveChatListPanel: (panel) => set({ activeChatListPanel: panel }),
  setActiveChatContentPanel: (panel, origin) =>
    set((state) => ({
      activeChatContentPanel: panel,
      searchOrigin: panel === "search" ? (origin ?? state.activeChatContentPanel) : state.searchOrigin,
    })),
  closeAllPanels: () =>
    set({ activeChatListPanel: "chatList", activeChatContentPanel: "none" }),
  setReplyTo: (msg) => set({ replyTo: msg }),
  setSearchJumpTargetId: (id) => set({ searchJumpTargetId: id }),
  setInChatMessageFilter: (filter) => set({ inChatMessageFilter: filter }),
  clearInChatMessageFilter: () => set({ inChatMessageFilter: null }),
}));
