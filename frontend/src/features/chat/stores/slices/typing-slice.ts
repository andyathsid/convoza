import type { StateCreator } from "zustand";
import type { ChatState } from "./types";
import {
  signalTyping as signalTypingPresence,
  stopTyping as stopTypingPresence,
  subscribeToTyping,
} from "@/features/chat/lib/typing";

export interface TypingSlice {
  typingByChat: Record<string, string[]>;
  typingUnsubscribes: Map<string, () => void>;
  syncTypingListeners: (chatIds: string[]) => void;
  stopListeningTyping: () => void;
  signalTyping: (chatId: string, userId: string) => void;
  stopTyping: () => void;
}

export const createTypingSlice: StateCreator<
  ChatState,
  [],
  [],
  TypingSlice
> = (set, get) => ({
  typingByChat: {},
  typingUnsubscribes: new Map(),

  syncTypingListeners: (chatIds) => {
    const desiredIds = new Set(chatIds.filter(Boolean));
    const subscriptions = new Map(get().typingUnsubscribes);
    const typingByChat = { ...get().typingByChat };

    for (const [chatId, unsubscribe] of subscriptions) {
      if (desiredIds.has(chatId)) continue;
      unsubscribe();
      subscriptions.delete(chatId);
      delete typingByChat[chatId];
    }

    for (const chatId of desiredIds) {
      if (subscriptions.has(chatId)) continue;
      const unsubscribe = subscribeToTyping(chatId, (userIds) => {
        set((state) => ({
          typingByChat: { ...state.typingByChat, [chatId]: userIds },
        }));
      });
      subscriptions.set(chatId, unsubscribe);
    }

    set({ typingUnsubscribes: subscriptions, typingByChat });
  },

  stopListeningTyping: () => {
    for (const unsubscribe of get().typingUnsubscribes.values()) {
      unsubscribe();
    }
    set({ typingUnsubscribes: new Map(), typingByChat: {} });
  },

  signalTyping: (chatId, userId) => signalTypingPresence(chatId, userId),
  stopTyping: () => stopTypingPresence(),
});
