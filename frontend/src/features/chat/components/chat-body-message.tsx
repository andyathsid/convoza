"use client";

import { memo } from "react";
import { useAuth } from "@/features/auth";
import { useProfiles } from "@/stores/use-profiles";
import { cn } from "@/lib/utils";
import ChatBubble from "./chat-bubble";
import type { FirestoreMessage } from "@/features/chat/types/chat";

interface Props {
  message: FirestoreMessage;
  onReply: (message: FirestoreMessage) => void;
  onRetry?: (pendingId: string) => void;
  showSenderInfo?: boolean;
  onOpenMedia?: (messageId: string, mediaIndex: number) => void;
  onJumpToMessage?: (messageId: string) => void;
  isHighlighted?: boolean;
  mediaGroupMessages?: FirestoreMessage[];
  onOpenGroupLightbox?: (messages: FirestoreMessage[], index: number) => void;
  isReadOnly?: boolean;
}

const ChatBodyMessage = memo(({ message, onReply, onRetry, showSenderInfo = false, onOpenMedia, onJumpToMessage, isHighlighted, mediaGroupMessages, onOpenGroupLightbox, isReadOnly = false }: Props) => {
  const { user } = useAuth();
  const userId = user?.id || null;
  const isCurrentUser = message.senderId === userId;
  const profile = useProfiles((s) => s.profiles.get(message.senderId));
  const senderName = isCurrentUser
    ? "You"
    : (profile?.username || message.senderName || message.sender?.username || "Unknown");
  const senderAvatar = isCurrentUser
    ? undefined
    : (profile?.avatar || message.senderAvatar || message.sender?.avatar);
  const isPending = !!message.pendingId;
  const isFailed = message.status === "failed";

  const containerClass = cn(
    "group flex gap-2 pb-1 px-4",
    isCurrentUser && "flex-row-reverse text-left"
  );

  const contentWrapperClass = cn(
    "w-fit max-w-[90%] flex flex-col relative",
    isCurrentUser && "items-end"
  );

  return (
    <div className={containerClass}>
      <div className={contentWrapperClass}>
        {showSenderInfo && !isCurrentUser && (
          <span className="text-xs font-semibold text-muted-foreground mb-0.5 px-1">
            {senderName}
          </span>
        )}

        <div className={cn("flex items-center gap-1", isCurrentUser && "flex-row-reverse")}>
          <ChatBubble
            message={message}
            isCurrentUser={isCurrentUser}
            isPending={isPending}
            isFailed={isFailed}
            onRetry={onRetry}
            onOpenMedia={onOpenMedia}
            onJumpToMessage={onJumpToMessage}
            isHighlighted={isHighlighted}
            mediaGroup={mediaGroupMessages}
            onOpenGroupLightbox={onOpenGroupLightbox}
            onReply={onReply}
            isReadOnly={isReadOnly}
          />
        </div>
      </div>
    </div>
  );
});

ChatBodyMessage.displayName = "ChatBodyMessage";

export default ChatBodyMessage;
