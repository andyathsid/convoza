"use client";

import { useEffect } from "react";
import { Highlight } from "react-instantsearch";
import AvatarWithBadge from "@/components/avatar-with-badge";
import type { Hit } from "instantsearch.js";
import { useProfiles } from "@/stores/use-profiles";
import type { ContactSearchDocument } from "@/features/chat/types/search";

interface ContactHitProps {
  hit: Hit<ContactSearchDocument>;
  onHitClick: (chatId: string, messageId?: string, userId?: string) => void;
}

export default function ContactHit({ hit, onHitClick }: ContactHitProps) {
  const profile = useProfiles((s) => s.getProfile(hit.id));
  const ensureProfiles = useProfiles((s) => s.ensureProfiles);

  useEffect(() => {
    ensureProfiles([hit.id]);
  }, [hit.id, ensureProfiles]);

  return (
    <button
      onClick={() => onHitClick("", undefined, hit.id)}
      className="w-full flex items-center gap-2 p-2 rounded-sm hover:bg-sidebar-accent transition-colors text-left"
    >
      <AvatarWithBadge name={profile?.username || hit.username} src={profile?.avatar} />
      <div className="flex-1 min-w-0">
        <Highlight hit={hit} attribute="username" highlightedTagName="mark" classNames={{ root: "text-sm font-semibold truncate" }} />
      </div>
    </button>
  );
}
