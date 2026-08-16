"use client";

import { useEffect } from "react";
import { Highlight } from "react-instantsearch";
import { Image as ImageIcon, Video, Music, Paperclip, FileText, CheckCheck, Check } from "lucide-react";
import { useProfiles } from "@/stores/use-profiles";
import type { Hit } from "instantsearch.js";
import type { MessageSearchDocument } from "@/features/chat/types/search";

interface MessageHitProps {
  hit: Hit<MessageSearchDocument>;
  onHitClick: (chatId: string, messageId: string) => void;
  currentUserId?: string;
}

function MediaIcon({ mediaType }: { mediaType: string }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (mediaType) {
    case "image":
      return <ImageIcon className={cls} />;
    case "video":
      return <Video className={cls} />;
    case "audio":
      return <Music className={cls} />;
    default:
      return <Paperclip className={cls} />;
  }
}

function mediaLabel(mediaType: string): string {
  switch (mediaType) {
    case "image":
      return "Photo";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    case "document":
      return "Document";
    default:
      return "Media";
  }
}

export default function MessageHit({ hit, onHitClick, currentUserId }: MessageHitProps) {
  const getProfile = useProfiles((s) => s.getProfile);
  const ensureProfiles = useProfiles((s) => s.ensureProfiles);

  useEffect(() => {
    if (hit.senderId) ensureProfiles([hit.senderId]);
  }, [hit.senderId, ensureProfiles]);

  const profile = hit.senderId ? getProfile(hit.senderId) : null;
  const senderName = profile?.username || (hit.senderId === currentUserId ? "You" : "");

  const isMedia = !!hit.mediaType;
  const hasContent = !!hit.content;
  const isDocument = hit.mediaType === "document";

  return (
    <button
      onClick={() => onHitClick(hit.chatId, hit.id)}
      className="w-full flex items-center gap-1 p-2 rounded-sm hover:bg-sidebar-accent transition-colors text-left"
    >
      <span className="shrink-0 text-xs text-muted-foreground">
        {currentUserId === hit.senderId ? (
          hit.readBy && hit.readBy.length > 0 ? (
            <CheckCheck className="h-3 w-3 text-blue-500" />
          ) : hit.deliveredTo && hit.deliveredTo.length > 0 ? (
            <CheckCheck className="h-3 w-3 text-muted-foreground" />
          ) : (
            <Check className="h-3 w-3 text-muted-foreground" />
          )
        ) : (
          <span className="truncate max-w-[120px]">{senderName}:</span>
        )}
      </span>
      {isDocument && <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      {isMedia && !isDocument && <MediaIcon mediaType={hit.mediaType || ""} />}
      {isMedia && !hasContent ? (
        <span className="text-sm text-muted-foreground truncate">
          {isDocument ? hit.documentName || "Document" : mediaLabel(hit.mediaType || "")}
        </span>
      ) : (
        <Highlight
          hit={hit}
          attribute="content"
          highlightedTagName="mark"
          classNames={{ root: "text-sm truncate text-muted-foreground min-w-0" }}
        />
      )}
    </button>
  );
}
