"use client";

import { useEffect, use, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { format, isSameDay } from "date-fns";
import { RotateCcw, X } from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import { useUIStore } from "@/stores/ui-store";
import { useAuth } from "@/stores/use-auth";
import ChatHeader from "@/components/chat/chat-header";
import ChatBody from "@/components/chat/chat-body";
import ChatFooter from "@/components/chat/chat-footer";
import EmptyState from "@/components/empty-state";
import MediaSkeleton from "@/components/chat/media-skeleton";
import InfoPanel from "@/components/chat/chat-info-panel";
import InChatSearchPanel from "@/components/chat/in-chat-search-panel";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useFilteredChatMessages } from "@/hooks/use-filtered-chat-messages";

// Threshold: chatList(440) + minChatContent(450) + infoPanel(440) + buffer(10) = 1240px
const PANEL_EXPAND_THRESHOLD = 1300;

function useExpandMode(): boolean {
  const [isExpand, setIsExpand] = useState(false);

  const update = useCallback(() => {
    setIsExpand(window.innerWidth < PANEL_EXPAND_THRESHOLD);
  }, []);

  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update]);

  return isExpand;
}

export default function ChatIdPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = use(params);
  const searchParams = useSearchParams();
  const targetMessageId = searchParams.get("m");

  const { chats, activeChat, messages, pendingMessages, isMessagesLoading, hasMoreMessages, isLoadingMoreMessages, hasNewerMessages, isLoadingNewerMessages, setActiveChat, updateActiveChat, stopListening, retryMessage, loadMoreMessages, loadNewerMessages } = useChatStore();
  const {
    setReplyTo,
    activeChatContentPanel,
    inChatMessageFilter,
    clearInChatMessageFilter,
    searchJumpTargetId,
    setSearchJumpTargetId,
  } = useUIStore();
  const { user } = useAuth();
  const currentUserId = user?.id || null;
  const isExpandMode = useExpandMode();
  const activeMessageFilter =
    inChatMessageFilter?.chatId === chatId ? inChatMessageFilter : null;
  const filteredMessages = useFilteredChatMessages(
    activeMessageFilter,
    currentUserId
  );

  // Start message listener immediately when chatId is available: don't wait for chats
  useEffect(() => {
    if (!chatId) return;
    setActiveChat(chatId);
  }, [chatId, setActiveChat]);

  useEffect(() => {
    if (inChatMessageFilter && inChatMessageFilter.chatId !== chatId) {
      clearInChatMessageFilter();
    }
  }, [chatId, clearInChatMessageFilter, inChatMessageFilter]);

  // Sync active chat enriched data once chats are loaded (participants, online status)
  useEffect(() => {
    if (!chatId || chats.length === 0) return;

    const chat = chats.find((c) => c.id === chatId);
    if (!chat) return;

    updateActiveChat(chat);
  }, [chatId, chats, updateActiveChat]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopListening();
  }, [stopListening]);

  const handleFilteredReplyJump = useCallback(
    (messageId: string) => {
      clearInChatMessageFilter();
      setSearchJumpTargetId(messageId);
    },
    [clearInChatMessageFilter, setSearchJumpTargetId]
  );

  useEffect(() => {
    if (
      !activeMessageFilter ||
      !searchJumpTargetId ||
      filteredMessages.isInitialLoading ||
      filteredMessages.messages.length > 0
    ) {
      return;
    }

    let cancelled = false;
    void filteredMessages.ensureMessage(searchJumpTargetId).then((found) => {
      if (!cancelled && !found) setSearchJumpTargetId(null);
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeMessageFilter,
    filteredMessages.ensureMessage,
    filteredMessages.isInitialLoading,
    filteredMessages.messages.length,
    searchJumpTargetId,
    setSearchJumpTargetId,
  ]);

  // Find the chat from the chats array (may be available before activeChat is set by effect)
  const chat = chats.find((c) => c.id === chatId);
  const selectedChat = activeChat?.id === chatId ? activeChat : null;

  // Show spinner only if chats haven't loaded from Firestore yet
  if (!selectedChat && chats.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner className="w-11 h-11 !text-primary" />
      </div>
    );
  }

  // Chat not found only when chats are loaded but this chatId doesn't exist
  if (!selectedChat && chats.length > 0 && !chat) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-lg">Chat not found</p>
      </div>
    );
  }

  // Filter pending messages for this chat
  const chatPendingMessages = pendingMessages.filter(m => m._chatId === chatId);

  const displayChat = selectedChat || chat;

  // When expand mode is active and panel is open, the info panel replaces the chat content entirely
  const panelFillsContent = activeChatContentPanel !== "none" && isExpandMode;
  const filterDateLabel = activeMessageFilter?.fromMs
    ? (() => {
        const from = new Date(activeMessageFilter.fromMs);
        const to = new Date(activeMessageFilter.toMs ?? activeMessageFilter.fromMs);
        return isSameDay(from, to)
          ? format(from, "MMM d, yyyy")
          : `${format(from, "MMM d, yyyy")} - ${format(to, "MMM d, yyyy")}`;
      })()
    : null;

  return (
    <div className="relative h-full flex w-full overflow-hidden">
      {/* Main Chat Area: hidden when panel is in expand mode */}
      <div
        className={cn(
          "h-full flex flex-col overflow-hidden",
          panelFillsContent ? "hidden" : "flex-1 min-w-0"
        )}
      >
        {displayChat && <ChatHeader chat={displayChat} currentUserId={currentUserId} />}
        <div className="flex-1 min-h-0 flex flex-col bg-background">
          {activeMessageFilter ? (
            <>
              <div className="flex items-center gap-2 border-b border-border bg-primary/5 px-4 py-2 text-sm">
                <div className="min-w-0 flex-1 truncate text-muted-foreground">
                  <span className="font-medium text-foreground">Filtered messages</span>
                  {activeMessageFilter.query ? (
                    <span> matching &ldquo;{activeMessageFilter.query}&rdquo;</span>
                  ) : null}
                  {filterDateLabel ? <span> from {filterDateLabel}</span> : null}
                </div>
                {filteredMessages.error ? (
                  <button
                    type="button"
                    onClick={filteredMessages.retry}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <RotateCcw className="size-3.5" />
                    Retry
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={clearInChatMessageFilter}
                  className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label="Clear message filter"
                >
                  <X className="size-4" />
                </button>
              </div>

              {filteredMessages.isInitialLoading ? (
                <div className="flex flex-1 items-center justify-center">
                  <Spinner className="size-8" />
                </div>
              ) : filteredMessages.error && filteredMessages.messages.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Unable to load filtered messages
                  </p>
                  <button
                    type="button"
                    onClick={filteredMessages.retry}
                    className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground"
                  >
                    Retry
                  </button>
                </div>
              ) : filteredMessages.messages.length === 0 ? (
                <EmptyState
                  title="No matching messages"
                  description="Try a different search or date range"
                />
              ) : (
                <ChatBody
                  key={`filtered-${filteredMessages.sessionKey}`}
                  messages={filteredMessages.messages}
                  pendingMessages={[]}
                  onReply={setReplyTo}
                  onRetry={retryMessage}
                  hasMoreMessages={filteredMessages.hasMore}
                  isLoadingMore={filteredMessages.isLoadingMore}
                  onLoadMore={filteredMessages.loadMore}
                  currentUserId={currentUserId}
                  participantIds={displayChat?.participants.map((participant) => participant.id) ?? []}
                  isGroup={displayChat?.isGroup ?? false}
                  isFiltered
                  onEnsureFilteredMessage={filteredMessages.ensureMessage}
                  onExitFilteredReplyJump={handleFilteredReplyJump}
                />
              )}
            </>
          ) : isMessagesLoading && messages.length === 0 ? (
            <div className="flex-1 flex flex-col gap-2 px-5 py-4 justify-end">
              <div className="self-start w-40 max-w-full h-10 bg-muted animate-pulse rounded-bl-xl rounded-r-xl" />
              <div className="self-end">
                <MediaSkeleton variant="landscape" />
              </div>
              <div className="self-start w-56 max-w-full h-10 bg-muted animate-pulse rounded-bl-xl rounded-r-xl" />
              <div className="self-start">
                <MediaSkeleton variant="portrait" />
              </div>
              <div className="self-end w-32 max-w-full h-10 bg-muted animate-pulse rounded-tr-xl rounded-l-xl" />
            </div>
          ) : (
            <ChatBody
              messages={messages}
              pendingMessages={chatPendingMessages}
              onReply={setReplyTo}
              onRetry={retryMessage}
              hasMoreMessages={hasMoreMessages}
              isLoadingMore={isLoadingMoreMessages}
              onLoadMore={() => loadMoreMessages(chatId)}
              hasNewerMessages={hasNewerMessages}
              isLoadingNewer={isLoadingNewerMessages}
              onLoadNewer={() => loadNewerMessages(chatId)}
              targetMessageId={targetMessageId}
              currentUserId={currentUserId}
              participantIds={displayChat?.participants.map((participant) => participant.id) ?? []}
              isGroup={displayChat?.isGroup ?? false}
            />
          )}
        </div>
        {!activeMessageFilter && <ChatFooter chatId={chatId} />}
      </div>

      {/* Backdrop scrim: shown on all sizes when panel is open */}
      {activeChatContentPanel !== "none" && (
        <div
          className={cn(
            "absolute inset-0 z-40 bg-black/40",
            // On wide screens (>= threshold), no backdrop: panel pushes normally
            !isExpandMode && "md:hidden"
          )}
          onClick={() => useUIStore.getState().setActiveChatContentPanel("none")}
        />
      )}

      {/* Right Side Panel */}
      <div
        className={cn(
          "shrink-0 h-full border-l border-border bg-card overflow-hidden z-50",
          !panelFillsContent && "transition-[width] duration-300 ease-in-out",
          activeChatContentPanel !== "none"
            ? panelFillsContent
              ? "w-full border-l"
              : "w-full md:w-[440px] border-l"
            : "w-0 border-l-0",
          panelFillsContent
            ? "absolute inset-0"
            : "md:relative absolute inset-y-0 right-0 md:shadow-none",
          activeChatContentPanel !== "none" && "shadow-xl"
        )}
      >
        <div
          className={cn(
            "h-full",
            !panelFillsContent && "transition-transform duration-300 ease-in-out",
            panelFillsContent
              ? "w-full"
              : "w-full md:w-[440px]",
            activeChatContentPanel !== "none" ? "translate-x-0" : "translate-x-full",
            "md:translate-x-0"
          )}
        >
          {displayChat && activeChatContentPanel === "info" && <InfoPanel chat={displayChat} currentUserId={currentUserId} />}
          {displayChat && activeChatContentPanel === "groupInfo" && <InfoPanel chat={displayChat} currentUserId={currentUserId} />}
          {displayChat && activeChatContentPanel === "search" && (
            <InChatSearchPanel
              key={chatId}
              chatId={chatId}
              isGroup={displayChat.isGroup}
              closeOnResultSelect={panelFillsContent}
            />
          )}
        </div>
      </div>
    </div>
  );
}
