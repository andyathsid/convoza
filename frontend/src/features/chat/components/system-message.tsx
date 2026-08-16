"use client";

import { useMemo } from "react";
import { useProfiles } from "@/stores/use-profiles";

interface Props {
  content: string;
  actorId?: string;
  targetId?: string;
  targetIds?: string[];
}

export default function SystemMessage({ content, actorId, targetId, targetIds }: Props) {
  const profiles = useProfiles((s) => s.profiles);

  const resolveName = (uid: string): string => {
    const p = profiles.get(uid);
    return p?.username || "";
  };

  const displayContent = useMemo(() => {
    const actorName = actorId ? resolveName(actorId) : undefined;

    let result = content;

    if (actorName) {
      const firstSpace = result.indexOf(" ");
      if (firstSpace !== -1) {
        result = actorName + result.slice(firstSpace);
      }
    }

    if (targetIds && targetIds.length > 0) {
      const addedIdx = result.indexOf(" added ");
      if (addedIdx !== -1) {
        const targetStart = addedIdx + " added ".length;
        const resolved = targetIds
          .map((id) => resolveName(id) || "Unknown")
          .join(", ");
        result = result.slice(0, targetStart) + resolved;
      }
    } else if (targetId) {
      const targetName = resolveName(targetId);
      if (targetName) {
        if (result.includes(" removed ")) {
          const targetStart = result.indexOf(" removed ") + " removed ".length;
          result = result.slice(0, targetStart) + targetName;
        } else if (result.includes(" made ")) {
          const targetStart = result.indexOf(" made ") + " made ".length;
          const rest = result.slice(targetStart);
          const spaceIdx = rest.indexOf(" ");
          if (spaceIdx !== -1) {
            result = result.slice(0, targetStart) + targetName + rest.slice(spaceIdx);
          } else {
            result = result.slice(0, targetStart) + targetName;
          }
        }
      }
    }

    return result;
  }, [content, actorId, targetId, targetIds, profiles]);

  return (
    <div className="flex justify-center my-2 px-4">
      <span className="text-xs text-muted-foreground bg-accent/40 rounded-md px-3 py-1.5 max-w-xs text-center leading-relaxed">
        {displayContent}
      </span>
    </div>
  );
}
