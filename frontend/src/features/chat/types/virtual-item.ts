import type { FirestoreMessage } from "./chat";

export interface LoadMoreItem {
  type: "load-more";
}

export interface LoadNewerItem {
  type: "load-newer";
}

export interface DateSeparator {
  type: "date-separator";
  date: string;
}

export interface MediaGroupItem {
  type: "media-group";
  messages: FirestoreMessage[];
  groupId: string;
}

export interface TypingIndicatorItem {
  type: "typing-indicator";
  text: string;
}

export type VirtualItem =
  | FirestoreMessage
  | LoadMoreItem
  | LoadNewerItem
  | DateSeparator
  | MediaGroupItem
  | TypingIndicatorItem;
