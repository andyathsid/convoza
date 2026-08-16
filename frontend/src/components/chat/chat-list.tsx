"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useChatStore } from "@/stores/chat-store";
import { useUIStore } from "@/stores/ui-store";
import { useAuth } from "@/stores/use-auth";
import ChatListHeader from "./chat-list-header";
import ChatListItem from "./chat-list-item";
import ChatSearch from "./chat-search";
import NewChatPanel from "./new-chat-panel";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import Logo from "@/components/logo";
import { CheckCircle2, MessageCircle, UsersRound } from "lucide-react";
import type { ChatListFilter } from "@/types/chat";

const FILTERS: Array<{ value: ChatListFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "groups", label: "Groups" },
];

function ChatListEmptyState({
  filter,
  currentUserId,
  onViewAll,
}: {
  filter: ChatListFilter;
  currentUserId: string | null;
  onViewAll: () => void;
}) {
  const config = filter === "unread"
    ? {
        icon: CheckCircle2,
        title: "No unread chats",
        description: "You're all caught up.",
      }
    : filter === "groups"
      ? {
          icon: UsersRound,
          title: "No group chats",
          description: "Group conversations will show up here.",
        }
      : {
          icon: MessageCircle,
          title: "No chats yet",
          description: "Start a conversation to see it here.",
        };
  const Icon = config.icon;
  const canViewAll = currentUserId && filter !== "all";

  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-8 text-center">
      <div className="mb-5 flex size-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 ring-4 ring-emerald-500/5 dark:text-emerald-400">
        <Icon className="size-8" strokeWidth={1.8} />
      </div>
      <h3 className="text-lg font-semibold tracking-tight text-foreground">
        {config.title}
      </h3>
      <p className="mt-2 text-sm text-muted-foreground">
        {config.description}
      </p>
      {canViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          className="mt-4 text-sm font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300"
        >
          View all chats
        </button>
      )}
    </div>
  );
}

const ChatList = () => {

  const router = useRouter();
  const { chats, activeChatFilter, unreadChatCount, isChatsLoading, listenPresence, stopListeningPresence, listenToChats, stopListeningChats, syncTypingListeners, stopListeningTyping, activeChat, loadMoreChats, hasMoreChats, isLoadingMoreChats, setChatFilter } = useChatStore();
  const { user } = useAuth();
  const currentUserId = user?.id || null;

  const [searchQuery, setSearchQuery] = useState("");

  const showCategories = searchQuery.trim().length > 0;

  useEffect(() => {
    if (!currentUserId) return;

    listenPresence();
    listenToChats(currentUserId);

    return () => {
      stopListeningChats();
      stopListeningPresence();
      stopListeningTyping();
    };
  }, [
    currentUserId,
    listenPresence,
    listenToChats,
    stopListeningChats,
    stopListeningPresence,
    stopListeningTyping,
  ]);

  useEffect(() => {
    if (!currentUserId) {
      syncTypingListeners([]);
      return;
    }
    syncTypingListeners(chats.map((chat) => chat.id));
  }, [chats, currentUserId, syncTypingListeners]);

  const onRoute = (id: string) => {
    router.push(`/chat/${id}`);
  };

  // IntersectionObserver for lazy loading more chats
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !currentUserId || !hasMoreChats) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !useChatStore.getState().isLoadingMoreChats) {
          loadMoreChats(currentUserId);
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [currentUserId, hasMoreChats, loadMoreChats]);

  const { activeChatListPanel } = useUIStore();

  return (
    <div className="h-full flex flex-col border-r border-border bg-sidebar overflow-hidden relative">
      {/* Main chat list */}
      <div className="absolute inset-0 flex flex-col">
        <ChatListHeader searchQuery={searchQuery} onSearch={setSearchQuery} />
        {!showCategories && (
          <div className="grid grid-cols-3 gap-2 px-3 py-2 border-b border-border" aria-label="Chat filters">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                aria-pressed={activeChatFilter === filter.value}
                onClick={() => currentUserId && setChatFilter(filter.value, currentUserId)}
                className={`inline-flex min-w-0 items-center justify-center rounded-full px-3 py-1 text-center text-xs font-medium whitespace-nowrap transition-colors ${
                  activeChatFilter === filter.value
                    ? "bg-emerald-600 text-white"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <span>{filter.label}</span>
                {filter.value === "unread" && unreadChatCount > 0 && (
                  <span className="ml-1.5 tabular-nums">{unreadChatCount > 99 ? "99+" : unreadChatCount}</span>
                )}
              </button>
            ))}
          </div>
        )}
        {showCategories ? (
          <ChatSearch
            query={searchQuery}
            onHitClick={async (chatId, messageId, userId) => {
              setSearchQuery("");
              if (currentUserId && activeChatFilter !== "all") {
                setChatFilter("all", currentUserId);
              }
              if (userId) {
                const chat = await useChatStore.getState().createChat({ participantId: userId });
                if (chat) {
                  router.push(`/chat/${chat.id}`);
                }
              } else {
                const url = messageId ? `/chat/${chatId}?m=${messageId}` : `/chat/${chatId}`;
                router.push(url);
              }
            }}
          />
        ) : (
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-2 pb-2 pt-1 space-y-1">
              {isChatsLoading ? (
                <div className="flex items-center justify-center">
                  <Spinner className="w-7 h-7" />
                </div>
              ) : chats?.length === 0 ? (
                <ChatListEmptyState
                  filter={activeChatFilter}
                  currentUserId={currentUserId}
                  onViewAll={() => currentUserId && setChatFilter("all", currentUserId)}
                />
              ) : (
                chats?.map((chat) => (
                  <ChatListItem
                    key={chat.id}
                    chat={chat}
                    currentUserId={currentUserId}
                    isActive={activeChat?.id === chat.id}
                    onClick={() => onRoute(chat.id)}
                  />
                ))
              )}
            </div>
            {hasMoreChats && (
              <div ref={sentinelRef} className="flex items-center justify-center py-3">
                {isLoadingMoreChats && <Spinner className="w-5 h-5" />}
              </div>
            )}
          </ScrollArea>
        )}
        <footer className="lg:hidden shrink-0 flex h-10 items-center justify-center border-t border-border bg-primary/85">
          <Logo
            url="/chat"
            imgClass="size-8 justify-center bg-transparent p-1"
            iconClass="text-white"
            textClass="text-white"
            showText={false}
          />
        </footer>
      </div>

      {/* New chat panel overlay - slides in from left */}
      <div
        className={`absolute inset-0 z-20 bg-card transition-transform duration-200 ease-in-out ${
          activeChatListPanel === "newChat" ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <NewChatPanel />
      </div>
    </div>
  );
};

export default ChatList;
