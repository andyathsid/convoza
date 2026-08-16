import { create } from "zustand";
import type { ChatState } from "./slices/types";
import { createPresenceSlice } from "./slices/presence-slice";
import { createChatListSlice } from "./slices/chat-list-slice";
import { createMessagesSlice } from "./slices/messages-slice";
import { createSendSlice } from "./slices/send-slice";
import { createTypingSlice } from "./slices/typing-slice";

export const useChatStore = create<ChatState>()((...a) => ({
  ...createPresenceSlice(...a),
  ...createChatListSlice(...a),
  ...createMessagesSlice(...a),
  ...createSendSlice(...a),
  ...createTypingSlice(...a),
}));
