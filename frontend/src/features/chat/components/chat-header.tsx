"use client";

import { useMemo, useEffect } from "react";
import { useChatStore } from "@/features/chat/stores/chat-store";
import { useProfiles } from "@/stores/use-profiles";
import { useUIStore } from "@/features/chat/stores/ui-store";
import { ArrowLeft, SquarePen, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import AvatarWithBadge from "@/components/avatar-with-badge";
import type { Chat } from "@/features/chat/types/chat";

interface Props {
  chat: Chat;
  currentUserId: string | null;
}

const ChatHeader = ({ chat, currentUserId }: Props) => {
  const router = useRouter();
  const profiles = useProfiles((s) => s.profiles);
  const missingProfiles = useProfiles((s) => s.missing);
  const presenceMap = useChatStore((s) => s.presenceMap);
  const { setActiveChatContentPanel, activeChatListPanel, setActiveChatListPanel } = useUIStore();

  const otherUid = useMemo(() => {
    if (chat.isGroup) return null;
    return chat.participants?.find((participant) => participant.id !== currentUserId)?.id || null;
  }, [chat.isGroup, chat.participants, currentUserId]);

  const profile = otherUid ? profiles.get(otherUid) : undefined;
  const isProfilePending = !!otherUid && !profile && !missingProfiles.has(otherUid);

  useEffect(() => {
    if (otherUid) {
      useProfiles.getState().ensureProfiles([otherUid]);
    }
  }, [otherUid]);

  const isOnline = otherUid ? !!presenceMap?.[otherUid] : false;

  const { name, subheading, avatar, isGroup } = useMemo(() => {
    if (chat.isGroup) {
      return {
        name: chat.groupName || "Unnamed Group",
        subheading: `${chat.participants?.length || 0} members`,
        avatar: chat.groupAvatar || "",
        isGroup: true,
      };
    }
    return {
      name: profile?.username || "Unknown",
      subheading: isOnline ? "Online" : "Offline",
      avatar: profile?.avatar || "",
      isGroup: false,
    };
  }, [chat.isGroup, chat.groupName, chat.participants?.length, chat.groupAvatar, profile, otherUid, isOnline]);

  const handleInfoClick = () => {
    if (isGroup) {
      setActiveChatContentPanel("groupInfo");
    } else {
      setActiveChatContentPanel("info");
    }
  };

  return (
    <div
      className="sticky top-0 flex items-center gap-5 border-b border-border bg-card px-2 z-50 cursor-pointer transition-colors select-none"
      onClick={handleInfoClick}
    >
      <div className="h-14 px-1 flex items-center w-full">
        <div>
          <ArrowLeft
            className="w-5 h-5 inline-block lg:hidden text-muted-foreground cursor-pointer mr-2"
            onClick={(e) => {
              e.stopPropagation();
              router.push("/chat");
            }}
          />
        </div>
        <div className="flex items-center max-w-full overflow-hidden flex-1 min-w-0">
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
          <div className="ml-2 min-w-0">
            {isProfilePending ? (
              <>
                <div className="mb-1 h-4 w-32 rounded bg-muted animate-pulse" />
                <div className="h-3 w-16 rounded bg-muted animate-pulse" />
              </>
            ) : (
              <>
                <h5 className="font-semibold truncate leading-tight">{name}</h5>
                <p
                  data-testid="chat-presence"
                  className={`text-sm truncate ${isOnline ? "text-green-500" : "text-muted-foreground"}`}
                >
                  {subheading}
                </p>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center shrink-0">
          <button
            type="button"
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-full transition-colors cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              setActiveChatContentPanel("search", "none");
            }}
            aria-label="Search messages"
          >
            <Search className="w-5 h-5" />
          </button>
          <button
            type="button"
            className="lg:hidden p-2 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setActiveChatListPanel(activeChatListPanel === "newChat" ? "chatList" : "newChat");
            }}
            aria-label="New chat"
          >
            <SquarePen className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatHeader;
