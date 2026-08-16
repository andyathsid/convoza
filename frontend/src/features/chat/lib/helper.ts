import { format, isToday, isYesterday, isThisWeek } from "date-fns";
import type { Chat, MessageTimestamp } from "@/features/chat/types/chat";

export type ChatDateValue = MessageTimestamp | string | number | null | undefined;

export function normalizeChatDate(value: ChatDateValue): Date | null {
  if (value === null || value === undefined) return null;

  const date =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : value.toDate();

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatChatTime(date: ChatDateValue): string {
  const d = normalizeChatDate(date);
  if (!d) return "";
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  if (isThisWeek(d)) return format(d, "EEEE");
  return format(d, "dd/MM/yy");
}

export function formatMessageTime(date: ChatDateValue): string {
  const d = normalizeChatDate(date);
  if (!d) return "";
  return format(d, "h:mm a");
}

export function formatDateLabel(date: ChatDateValue): string {
  const d = normalizeChatDate(date);
  if (!d) return "";
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "dd/MM/yyyy");
}

export function getOtherUserAndGroup(
  chat: Chat,
  currentUserId: string | null,
  presenceMap?: Record<string, boolean>
) {
  if (chat.isGroup) {
    return {
      name: chat.groupName || "Unnamed Group",
      subheading: `${chat.participants?.length || 0} members`,
      avatar: chat.groupAvatar || "",
      isGroup: true,
      isOnline: false,
    };
  }

  const other = chat.participants?.find((participant) => participant.id !== currentUserId);
  const online = !!(other?.id && presenceMap?.[other.id]);
  return {
    name: other?.username || "Unknown",
    subheading: online ? "Online" : "Offline",
    avatar: other?.avatar || "",
    isGroup: false,
    isOnline: online,
  };
}
