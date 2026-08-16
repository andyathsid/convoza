"use client";

import { useEffect } from "react";
import AvatarWithBadge from "@/components/avatar-with-badge";
import { Users, FileText, Image as ImageIcon, Video, Music } from "lucide-react";
import type { Hit } from "instantsearch.js";
import { useChatStore } from "@/features/chat/stores/chat-store";
import { useProfiles } from "@/stores/use-profiles";
import type { ChatSearchDocument } from "@/features/chat/types/search";
import SearchHighlight from "./search-highlight";

interface ChatHitProps {
  hit: Hit<ChatSearchDocument>;
  currentUserId?: string;
  query: string;
  onHitClick: (chatId: string) => void;
}

function LastMessagePreview({ chatId }: { chatId: string }) {
  const chat = useChatStore((s) => s.chats?.find((c) => c.id === chatId));
  const last = chat?.lastMessage;

  const isDocument = last?.mediaType === "document";
  const isMedia = !!last?.mediaType;

  if (!last) return null;

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
      {isDocument ? (
        <FileText className="h-3 w-3 shrink-0" />
      ) : isMedia ? (
        last.mediaType === "image"
          ? <ImageIcon className="h-3 w-3 shrink-0" />
          : last.mediaType === "video"
            ? <Video className="h-3 w-3 shrink-0" />
            : <Music className="h-3 w-3 shrink-0" />
      ) : null}
      {isMedia && !last.content ? (
        <span className="truncate">
          {isDocument ? (last.documentName || "Document") : last.mediaType === "image" ? "Photo" : last.mediaType === "video" ? "Video" : "Audio"}
        </span>
      ) : (
        <span className="truncate">{last.content}</span>
      )}
    </div>
  );
}

export default function ChatHit({ hit, currentUserId, query, onHitClick }: ChatHitProps) {
  const loadedChat = useChatStore((s) => s.chats.find((chat) => chat.id === hit.id));
  const getProfile = useProfiles((s) => s.getProfile);
  const ensureProfiles = useProfiles((s) => s.ensureProfiles);
  const otherParticipantId = hit.isGroup
    ? undefined
    : hit.participants.find((participantId) => participantId !== currentUserId);

  useEffect(() => {
    if (otherParticipantId) ensureProfiles([otherParticipantId]);
  }, [otherParticipantId, ensureProfiles]);

   const participantIndex = otherParticipantId ? hit.participants.indexOf(otherParticipantId) : -1;
   const profile = otherParticipantId ? getProfile(otherParticipantId) : undefined;
   const name = hit.isGroup
     ? loadedChat?.groupName || hit.groupName || "Unnamed Group"
     : profile?.username || (participantIndex >= 0 ? hit.participantNames[participantIndex] : "") || "Unknown";
  const avatar = hit.isGroup ? loadedChat?.groupAvatar : profile?.avatar;

  return (
    <button
      onClick={() => onHitClick(hit.id)}
      className="w-full flex items-center gap-2 p-2 rounded-sm hover:bg-sidebar-accent transition-colors text-left"
    >
      <AvatarWithBadge name={name} src={avatar} isGroup={hit.isGroup} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <SearchHighlight value={name} query={query} className="text-sm font-semibold truncate" />
          {hit.isGroup && (
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground shrink-0">
              <Users className="w-3 h-3" />
              {hit.participants?.length || 0}
            </span>
          )}
        </div>
        <LastMessagePreview chatId={hit.id} />
      </div>
    </button>
  );
}
