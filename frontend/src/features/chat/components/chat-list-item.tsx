"use client";

import { memo, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { formatChatTime } from "@/features/chat/lib/helper";
import { useChatStore } from "@/features/chat/stores/chat-store";
import { useProfiles } from "@/stores/use-profiles";
import AvatarWithBadge from "@/components/avatar-with-badge";
import { FileText, Image, Video, Music } from "lucide-react";
import type { Chat } from "@/features/chat/types/chat";
import { formatTypingText } from "@/features/chat/lib/typing";

const EMPTY_TYPING_USER_IDS: string[] = [];

interface PropsType {
  chat: Chat;
  currentUserId: string | null;
  isActive: boolean;
  onClick?: () => void;
}

const ChatListItem = memo(({ chat, currentUserId, isActive, onClick }: PropsType) => {
  const { lastMessage, createdAt } = chat;
  const unreadCount = chat.unreadCount || 0;
  const hasUnread = chat.hasUnread === true && unreadCount > 0;
  const presenceMap = useChatStore((s) => s.presenceMap);
  const typingUserIds = useChatStore(
    (s) => s.typingByChat[chat.id] ?? EMPTY_TYPING_USER_IDS,
  );
  const profiles = useProfiles((s) => s.profiles);
  const missingProfiles = useProfiles((s) => s.missing);

  const otherUid = useMemo(() => {
    if (chat.isGroup) return null;
    return chat.participants?.find((participant) => participant.id !== currentUserId)?.id || null;
  }, [chat.isGroup, chat.participants, currentUserId]);

  const profile = otherUid ? profiles.get(otherUid) : undefined;
  const isProfilePending = !!otherUid && !profile && !missingProfiles.has(otherUid);

  useEffect(() => {
    if (otherUid) useProfiles.getState().ensureProfiles([otherUid]);
  }, [otherUid]);

  const visibleTypingUserIds = useMemo(() => {
    const participantIds = new Set(chat.participants.map((participant) => participant.id));
    return typingUserIds.filter(
      (userId) => userId !== currentUserId && participantIds.has(userId),
    );
  }, [chat.participants, currentUserId, typingUserIds]);

  useEffect(() => {
    if (visibleTypingUserIds.length > 0) {
      void useProfiles.getState().ensureProfiles(visibleTypingUserIds);
    }
  }, [visibleTypingUserIds]);

  const typingText = useMemo(() => {
    const names = visibleTypingUserIds.map(
      (userId) => profiles.get(userId)?.username || "Someone",
    );
    return formatTypingText(names, { compactDirect: !chat.isGroup });
  }, [chat.isGroup, profiles, visibleTypingUserIds]);

  const { name, avatar, isOnline, isGroup } = useMemo(() => {
    if (chat.isGroup) {
      return {
        name: chat.groupName || "Unnamed Group",
        avatar: chat.groupAvatar || "",
        isGroup: true,
        isOnline: false,
      };
    }
    const online = !!(otherUid && presenceMap?.[otherUid]);
    return {
      name: profile?.username || "Unknown",
      avatar: profile?.avatar || "",
      isGroup: false,
      isOnline: online,
    };
  }, [chat.isGroup, chat.groupName, chat.groupAvatar, otherUid, profile, presenceMap]);

  const getLastMessageText = () => {
    if (!lastMessage) {
      return isGroup
        ? chat.createdBy === currentUserId
          ? "Group created"
          : "You were added"
        : "Send a message";
    }
    if (lastMessage.mediaUrl) {
      if (lastMessage.mediaType === "video") return "Video";
      if (lastMessage.mediaType === "audio") return "Audio";
      if (lastMessage.mediaType === "document") return "Document";
      return "Photo";
    }
    const senderName = lastMessage.sender?.username || lastMessage.senderName || "";
    if (isGroup && senderName) {
      return `${lastMessage.senderId === currentUserId ? "You" : senderName}: ${lastMessage.content}`;
    }
    return lastMessage.content;
  };

  const renderLastMessage = () => {
    if (typingText) {
      return (
        <span className="block truncate text-xs font-medium text-primary">
          {typingText}
        </span>
      );
    }

    if (!lastMessage) {
      return (
        <span className="text-xs truncate text-muted-foreground">
          {isGroup
            ? chat.createdBy === currentUserId
              ? "Group created"
              : "You were added"
            : "Send a message"}
        </span>
      );
    }

    const isDocument = lastMessage.mediaType === "document";
    const isMedia = !!lastMessage.mediaType;
    const hasCaption = !!lastMessage.content;
    const senderName = lastMessage.sender?.username || lastMessage.senderName || "";
    const showSender = isGroup && senderName;
    const senderPrefix = lastMessage.senderId === currentUserId ? "You" : senderName;

    const mediaLabel = isDocument
      ? (lastMessage.documentName || "Document")
      : lastMessage.mediaType === "image" ? "Photo"
      : lastMessage.mediaType === "video" ? "Video"
      : lastMessage.mediaType === "audio" ? "Audio"
      : null;

    return (
      <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
        {showSender && (
          <span className="shrink-0 truncate max-w-[40%]">{senderPrefix}:</span>
        )}
        {isDocument && <FileText className="h-3 w-3 shrink-0" />}
        {lastMessage.mediaType === "image" && !hasCaption && <Image className="h-3 w-3 shrink-0" />}
        {lastMessage.mediaType === "video" && !hasCaption && <Video className="h-3 w-3 shrink-0" />}
        {lastMessage.mediaType === "audio" && !hasCaption && <Music className="h-3 w-3 shrink-0" />}
        {isMedia && !hasCaption ? (
          <span className="truncate">{mediaLabel}</span>
        ) : (
          <span className="truncate">{lastMessage.content}</span>
        )}
      </div>
    );
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 p-2 rounded-sm hover:bg-sidebar-accent transition-colors text-left",
        isActive && "max-lg:bg-transparent lg:!bg-sidebar-accent"
      )}
    >
      {isProfilePending ? (
        <div className="h-9 w-9 shrink-0 rounded-full bg-muted animate-pulse" />
      ) : (
        <AvatarWithBadge
          name={name}
          src={avatar}
          isGroup={isGroup}
          isOnline={isOnline}
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          {isProfilePending ? (
            <div className="h-4 w-28 rounded bg-muted animate-pulse" />
          ) : (
            <h5 className={cn("text-sm truncate", hasUnread ? "font-bold" : "font-semibold")}>{name}</h5>
          )}
          <span className={cn("text-xs ml-2 shrink-0", hasUnread ? "font-medium text-primary" : "text-muted-foreground")}>
            {formatChatTime(lastMessage ? (lastMessage.createdAt || lastMessage.timestamp) : createdAt)}
          </span>
        </div>
        <div className="-mt-px flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">{renderLastMessage()}</div>
          {hasUnread && (
            <span
              className="flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground"
              aria-label={`${unreadCount} unread messages`}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
});

ChatListItem.displayName = "ChatListItem";

export default ChatListItem;
