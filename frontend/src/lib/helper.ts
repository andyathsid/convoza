import { format, isToday, isYesterday, isThisWeek } from "date-fns";

export function formatChatTime(date: any): string {
  if (!date) return "";
  // Handle Firestore Timestamp objects
  const d = typeof date?.toDate === "function" ? date.toDate() : new Date(date);
  if (isNaN(d.getTime())) return "";
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return "Yesterday";
  if (isThisWeek(d)) return format(d, "EEEE");
  return format(d, "dd/MM/yy");
}

export function formatMessageTime(date: any): string {
  if (!date) return "";
  const d = typeof date?.toDate === "function" ? date.toDate() : new Date(date);
  if (isNaN(d.getTime())) return "";
  return format(d, "h:mm a");
}

export function formatDateLabel(date: any): string {
  if (!date) return "";
  const d = typeof date?.toDate === "function" ? date.toDate() : new Date(date);
  if (isNaN(d.getTime())) return "";
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "dd/MM/yyyy");
}

export function getOtherUserAndGroup(
  chat: any,
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

  const other = chat.participants?.find((p: any) => p.id !== currentUserId);
  const online = !!(other?.id && presenceMap?.[other.id]);
  return {
    name: other?.username || "Unknown",
    subheading: online ? "Online" : "Offline",
    avatar: other?.avatar || "",
    isGroup: false,
    isOnline: online,
  };
}
