"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { useProfiles } from "@/stores/use-profiles";
import type { MessageType } from "@/types";

interface Props {
  replyTo: MessageType;
  onCancel: () => void;
}

const ChatReplyBar = ({ replyTo, onCancel }: Props) => {
  const profiles = useProfiles((s) => s.profiles);
  const profile = replyTo.senderId ? profiles.get(replyTo.senderId) : undefined;
  const senderName = replyTo.senderName || replyTo.sender?.username || profile?.username || "Unknown";

  useEffect(() => {
    if (replyTo.senderId) useProfiles.getState().ensureProfiles([replyTo.senderId]);
  }, [replyTo.senderId]);

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-l-4 border-l-primary bg-primary/10 animate-in slide-in-from-bottom-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-primary">{senderName}</p>
        <p className="text-xs text-muted-foreground truncate">
          {replyTo.content || (replyTo.mediaUrl ? (replyTo.mediaType === "video" ? "Video" : replyTo.mediaType === "audio" ? "Audio" : replyTo.mediaType === "document" ? "Document" : "Photo") : "")}
        </p>
      </div>
      <button onClick={onCancel} className="p-1 hover:bg-muted rounded-full">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

export default ChatReplyBar;
