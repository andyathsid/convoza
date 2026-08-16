"use client";

import { useEffect } from "react";
import AvatarWithBadge from "@/components/avatar-with-badge";
import { Users } from "lucide-react";
import type { Hit } from "instantsearch.js";
import { useProfiles } from "@/stores/use-profiles";
import type { GroupSearchDocument } from "@/types/search";
import type { SearchChatMetadata } from "@/stores/slices/chat-list-slice";

interface GroupHitProps {
  hit: Hit<GroupSearchDocument>;
  metadata?: SearchChatMetadata;
  onHitClick: (chatId: string) => void;
  query: string;
}

export default function GroupHit({ hit, metadata, onHitClick, query }: GroupHitProps) {
  const profiles = useProfiles((s) => s.profiles);
  const ensureProfiles = useProfiles((s) => s.ensureProfiles);

  useEffect(() => {
    ensureProfiles(hit.participants);
  }, [hit.participants, ensureProfiles]);

  const q = query.toLowerCase().trim();
  const names = hit.participants.map((participantId, index) => (
    profiles.get(participantId)?.username || hit.participantNames[index] || participantId
  ));
  const matchedName = names?.find((name) => name.toLowerCase().includes(q)) || names?.[0] || "Someone";
  const groupName = metadata?.groupName || "Unnamed Group";

  return (
    <button
      onClick={() => onHitClick(hit.id)}
      className="w-full flex items-center gap-2 p-2 rounded-sm hover:bg-sidebar-accent transition-colors text-left"
    >
      <AvatarWithBadge name={groupName} src={metadata?.groupAvatar} isGroup />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold truncate">{groupName}</span>
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground shrink-0">
            <Users className="w-3 h-3" />
            {hit.participants?.length || hit.participantNames?.length || 0}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {matchedName} is also in this group
        </p>
      </div>
    </button>
  );
}
