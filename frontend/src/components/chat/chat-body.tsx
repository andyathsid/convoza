"use client";

import { useEffect, useRef, useCallback, useMemo, useState, startTransition } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Virtualizer, type VirtualizerHandle } from "virtua";
import type { MessageType } from "@/types";
import { useChatStore } from "@/stores/chat-store";
import { useUIStore } from "@/stores/ui-store";
import { useProfiles } from "@/stores/use-profiles";
import ChatBodyMessage from "./chat-body-message";
import SystemMessage from "./system-message";
import MediaLightbox from "./media-lightbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import JumpToBottomButton from "./jump-to-bottom-button";
import { useScrollToBottom } from "../../hooks/use-scroll-to-bottom";
import { useJumpToMessage } from "../../hooks/use-jump-to-message";
import { useChatPagination, isLoadMoreItem, isLoadNewerItem } from "@/components/chat/use-chat-pagination";
import type { LoadMoreItem, LoadNewerItem } from "@/components/chat/use-chat-pagination";
import { formatDateLabel } from "@/lib/helper";
import { formatTypingText } from "@/lib/typing";
import EmptyState from "@/components/empty-state";

const EMPTY_TYPING_USER_IDS: string[] = [];

interface Props {
  messages: MessageType[];
  pendingMessages: MessageType[];
  onReply: (message: MessageType) => void;
  onRetry: (pendingId: string) => void;
  hasMoreMessages?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  hasNewerMessages?: boolean;
  isLoadingNewer?: boolean;
  onLoadNewer?: () => void;
  targetMessageId?: string | null;
  currentUserId?: string | null;
  participantIds?: string[];
  sessionSentMessageIds?: Set<string>;
  isGroup?: boolean;
  isFiltered?: boolean;
  onEnsureFilteredMessage?: (messageId: string) => Promise<boolean>;
  onExitFilteredReplyJump?: (messageId: string) => void;
}

interface DateSeparator {
  type: "date-separator";
  date: string;
}

interface MediaGroupItem {
  type: "media-group";
  messages: MessageType[];
  groupId: string;
}

interface TypingIndicatorItem {
  type: "typing-indicator";
  text: string;
}

export type VirtualItem = MessageType | LoadMoreItem | LoadNewerItem | DateSeparator | MediaGroupItem | TypingIndicatorItem;

function isDateSeparator(item: VirtualItem): item is DateSeparator {
  return (item as DateSeparator).type === "date-separator";
}

function isMediaGroupItem(item: VirtualItem): item is MediaGroupItem {
  return (item as MediaGroupItem).type === "media-group";
}

function isTypingIndicator(item: VirtualItem): item is TypingIndicatorItem {
  return (item as TypingIndicatorItem).type === "typing-indicator";
}

function hasIrregularCaptions(group: MessageType[]): boolean {
  for (let k = 1; k < group.length; k++) {
    if (group[k].content) return true;
  }
  return false;
}

function groupMessages(messages: MessageType[]): VirtualItem[] {
  const result: VirtualItem[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (
      msg.groupId &&
      (msg.mediaType === "image" || msg.mediaType === "video")
    ) {
      const MAX_GROUP = 30;
      const group: MessageType[] = [msg];
      let j = i + 1;
      while (
        j < messages.length &&
        messages[j].groupId === msg.groupId &&
        (messages[j].mediaType === "image" || messages[j].mediaType === "video") &&
        group.length < MAX_GROUP
      ) {
        group.push(messages[j]);
        j++;
      }

      if (group.length > 1) {
        const getIdx = (item: MessageType) => item.groupIndex ?? 0;
        group.sort((a, b) => getIdx(a) - getIdx(b));
        if (hasIrregularCaptions(group)) {
          for (const m of group) {
            result.push(m);
          }
          i = j;
          continue;
        }

        const firstHasCaption = !!group[0].content;

        if (group.length >= 4 && firstHasCaption) {
          for (const m of group) {
            result.push(m);
          }
          i = j;
          continue;
        }

        result.push({ type: "media-group", messages: group, groupId: msg.groupId });
        i = j;
        continue;
      }
    }

    result.push(msg);
    i++;
  }

  return result;
}

function waitForLoadComplete(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (!useChatStore.getState().isLoadingMoreMessages) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function findTargetIndexInItems(items: VirtualItem[], targetId: string): number {
  return items.findIndex((item) => {
    if (isLoadMoreItem(item) || isLoadNewerItem(item) || isDateSeparator(item) || isTypingIndicator(item)) return false;
    if (isMediaGroupItem(item)) {
      return item.messages.some(
        (m) => m.id === targetId || m.pendingId === targetId
      );
    }
    const msg = item as MessageType;
    return msg.id === targetId || msg.pendingId === targetId;
  });
}

function findMediaMessageIndex(mediaMessages: MessageType[], target: MessageType): number {
  return mediaMessages.findIndex((candidate) => {
    if (candidate === target) return true;

    if (
      (target.id && (candidate.id === target.id || candidate.pendingId === target.id)) ||
      (target.pendingId && (candidate.id === target.pendingId || candidate.pendingId === target.pendingId))
    ) {
      return true;
    }

    // Pending messages can be replaced by their Firestore copy before a click is handled.
    return (
      !!target.groupId &&
      candidate.groupId === target.groupId &&
      candidate.groupIndex === target.groupIndex
    );
  });
}

const ChatBody = ({
  messages,
  pendingMessages,
  onReply,
  onRetry,
  hasMoreMessages = false,
  isLoadingMore = false,
  onLoadMore,
  hasNewerMessages = false,
  isLoadingNewer = false,
  onLoadNewer,
  targetMessageId,
  currentUserId,
  participantIds = [],
  sessionSentMessageIds,
  isGroup = false,
  isFiltered = false,
  onEnsureFilteredMessage,
  onExitFilteredReplyJump,
}: Props) => {
  const viewPortRef = useRef<HTMLDivElement>(null);
  const virtualizerRef = useRef<VirtualizerHandle>(null);
  const prevPendingLen = useRef(0);
  const prevItemCount = useRef(0);
  const initialScrollDone = useRef(false);
  const activeDateRef = useRef<string | null>(null);
  const dateSeparatorIndicesRef = useRef<number[]>([]);
  const allItemsRef = useRef<VirtualItem[]>([]);
  const [stickyDate, setStickyDate] = useState<string | null>(null);
  const [showStickyDate, setShowStickyDate] = useState(false);

  const chatId = useChatStore((s) => s.currentChatId);
  const typingUserIds = useChatStore(
    (s) => (chatId ? s.typingByChat[chatId] : undefined) ?? EMPTY_TYPING_USER_IDS,
  );
  const isJumpingToMessage = useChatStore((s) => s.isJumpingToMessage);
  const storeJumpToMessage = useChatStore((s) => s.jumpToMessage);
  const jumpToLatestMessage = useChatStore((s) => s.jumpToLatestMessage);
  const unseenCounts = useChatStore((s) => s.unseenCounts);
  const resetUnseenCount = useChatStore((s) => s.resetUnseenCount);
  const jumpTriggeredRef = useRef(false);
  const postJumpRef = useRef(false);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingReplyJumpRef = useRef<string | null>(null);
  const profiles = useProfiles((s) => s.profiles);

  const visibleTypingUserIds = useMemo(() => {
    const participantSet = new Set(participantIds);
    return typingUserIds.filter(
      (userId) => userId !== currentUserId && participantSet.has(userId),
    );
  }, [currentUserId, participantIds, typingUserIds]);

  useEffect(() => {
    if (visibleTypingUserIds.length > 0) {
      void useProfiles.getState().ensureProfiles(visibleTypingUserIds);
    }
  }, [visibleTypingUserIds]);

  const typingText = useMemo(() => {
    const names = visibleTypingUserIds.map(
      (userId) => profiles.get(userId)?.username || "Someone",
    );
    return formatTypingText(names);
  }, [profiles, visibleTypingUserIds]);

  const [lightboxState, setLightboxState] = useState<{
    messages: MessageType[];
    initialIndex: number;
  } | null>(null);

  const {
    shouldShift,
    prependItem,
    appendItem,
    checkScrollTriggers,
    renderLoadMore,
    renderLoadNewer,
  } = useChatPagination({
    hasMoreMessages,
    isLoadingMore,
    onLoadMore,
    hasNewerMessages,
    isLoadingNewer,
    onLoadNewer,
    virtualizerRef,
  });

  const allMediaMessages = useMemo(() => {
    const items: MessageType[] = [];
    const seenIds = new Set<string>();

    for (const msg of messages) {
      if (msg.mediaUrl && (msg.mediaType === "image" || msg.mediaType === "video")) {
        items.push(msg);
        if (msg.id) seenIds.add(msg.id);
      }
    }

    for (const msg of pendingMessages) {
      if (msg.mediaUrl && (msg.mediaType === "image" || msg.mediaType === "video")) {
        const reconciledId = msg.id || "";
        if (!reconciledId || !seenIds.has(reconciledId)) {
          items.push(msg);
        }
      }
    }

    return items;
  }, [messages, pendingMessages]);

  const getMessageDate = (msg: MessageType): Date => {
    const d = typeof msg.createdAt?.toDate === "function"
      ? msg.createdAt.toDate()
      : new Date(msg.createdAt);
    return isNaN(d.getTime()) ? new Date(0) : d;
  };

  const isSameDay = (a: Date, b: Date): boolean => {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  };

  const allItems = useMemo(() => {
    const items: VirtualItem[] = [];

    if (prependItem) {
      items.push(prependItem);
    }

    const grouped = groupMessages(messages);

    const seenMsgIds = new Set<string>();
    const deduped: VirtualItem[] = [];
    for (const item of grouped) {
      const msg = isMediaGroupItem(item) ? item.messages[0] : (item as MessageType);
      const msgId = msg.id || msg.pendingId;
      if (msgId && seenMsgIds.has(msgId)) {
        continue;
      }
      if (msgId) seenMsgIds.add(msgId);
      deduped.push(item);
    }

    let lastDate: Date | null = null;
    for (const item of deduped) {
      const msg = isMediaGroupItem(item) ? item.messages[0] : (item as MessageType);
      const msgDate = getMessageDate(msg);
      if (!lastDate || !isSameDay(msgDate, lastDate)) {
        items.push({ type: "date-separator", date: formatDateLabel(msg.createdAt) });
        lastDate = msgDate;
      }
      items.push(item);
    }

    const dedupedPending = pendingMessages.filter((pm) => {
      const id = pm.id || pm.pendingId;
      if (!id) return true;
      if (seenMsgIds.has(id)) return false;
      seenMsgIds.add(id);
      return true;
    });

    for (const pm of dedupedPending) {
      const msgDate = getMessageDate(pm);
      if (!lastDate || !isSameDay(msgDate, lastDate)) {
        items.push({ type: "date-separator", date: formatDateLabel(pm.createdAt) });
        lastDate = msgDate;
      }
      items.push(pm);
    }

    if (appendItem) {
      items.push(appendItem);
    }

    if (typingText && !isFiltered && !hasNewerMessages) {
      items.push({ type: "typing-indicator", text: typingText });
    }

    return items;
  }, [prependItem, messages, pendingMessages, appendItem, typingText, isFiltered, hasNewerMessages]);

  const unseenMessageCount = unseenCounts.get(chatId ?? "") ?? 0;

  const {
    isAtBottom,
    scrollToBottom,
    handleScroll: handleScrollToBottom,
    reset: resetScrollToBottom,
    shouldAutoScroll,
  } = useScrollToBottom({ virtualizerRef, itemCount: allItems.length, postJumpRef });

  const {
    highlightedMessageId,
    setHighlightedMessageId,
    jumpToMessage,
    jumpScrollJustCompleted,
    clearHighlight,
    highlightMessage,
  } = useJumpToMessage({
    virtualizerRef,
    allItemsRef,
    shouldAutoScroll,
    hasMoreMessages,
    onLoadMore,
    chatId,
    storeJumpToMessage,
    findTargetIndex: findTargetIndexInItems,
    getStoreState: () => useChatStore.getState(),
  });

  const handleReplyJump = useCallback(async (targetId: string) => {
    if (!chatId) return;
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    clearHighlight();

    const existingIndex = findTargetIndexInItems(
      allItemsRef.current,
      targetId
    );
    if (existingIndex >= 0) {
      shouldAutoScroll.current = false;
      postJumpRef.current = true;
      jumpScrollJustCompleted.current = true;
      virtualizerRef.current?.scrollToIndex(existingIndex, {
        align: "center",
        smooth: true,
      });
      setHighlightedMessageId(targetId);
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedMessageId(null);
        highlightTimerRef.current = null;
      }, 1500);
      return;
    }

    pendingReplyJumpRef.current = targetId;
    const targetIdx = await storeJumpToMessage(chatId, targetId);
    if (targetIdx !== null && targetIdx >= 0) {
      await waitForAnimationFrame();
      await waitForAnimationFrame();
      const found = findTargetIndexInItems(allItemsRef.current, targetId);
      if (found >= 0) {
        shouldAutoScroll.current = false;
        postJumpRef.current = true;
        jumpScrollJustCompleted.current = true;
        virtualizerRef.current?.scrollToIndex(found, { align: "center", smooth: true });
        setHighlightedMessageId(targetId);
        highlightTimerRef.current = setTimeout(() => {
          setHighlightedMessageId(null);
          highlightTimerRef.current = null;
        }, 1500);
      }
    }
    pendingReplyJumpRef.current = null;
  }, [chatId, storeJumpToMessage, clearHighlight, jumpScrollJustCompleted]);

  const handleSearchJump = useCallback(
    async (targetId: string) => {
      const existingIndex = findTargetIndexInItems(
        allItemsRef.current,
        targetId
      );
      if (existingIndex >= 0 || !isFiltered || !onEnsureFilteredMessage) {
        await handleReplyJump(targetId);
        return;
      }

      pendingReplyJumpRef.current = targetId;
      const found = await onEnsureFilteredMessage(targetId);
      if (!found) {
        pendingReplyJumpRef.current = null;
        toast.error("Message could not be loaded");
      }
    },
    [handleReplyJump, isFiltered, onEnsureFilteredMessage]
  );

  const handleBubbleReplyJump = useCallback(
    (targetId: string) => {
      const targetIsVisible =
        findTargetIndexInItems(allItemsRef.current, targetId) >= 0;
      if (isFiltered && !targetIsVisible && onExitFilteredReplyJump) {
        onExitFilteredReplyJump(targetId);
        return;
      }

      void handleReplyJump(targetId);
    },
    [handleReplyJump, isFiltered, onExitFilteredReplyJump]
  );

  useEffect(() => {
    const pending = pendingReplyJumpRef.current;
    if (!pending || isJumpingToMessage) return;

    const found = findTargetIndexInItems(allItemsRef.current, pending);
    if (found >= 0) {
      shouldAutoScroll.current = false;
      postJumpRef.current = true;
      virtualizerRef.current?.scrollToIndex(found, { align: "center", smooth: true });
      setHighlightedMessageId(pending);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedMessageId(null);
        highlightTimerRef.current = null;
      }, 1500);
      pendingReplyJumpRef.current = null;
    }
  }, [messages, isJumpingToMessage]);

  const searchJumpTargetId = useUIStore((s) => s.searchJumpTargetId);
  const setSearchJumpTargetId = useUIStore((s) => s.setSearchJumpTargetId);

  useEffect(() => {
    if (!searchJumpTargetId) return;
    setSearchJumpTargetId(null);
    void handleSearchJump(searchJumpTargetId);
  }, [searchJumpTargetId, setSearchJumpTargetId, handleSearchJump]);

  const dateSeparatorIndices = useMemo(() => {
    const indices: number[] = [];
    for (let i = 0; i < allItems.length; i++) {
      if (isDateSeparator(allItems[i])) indices.push(i);
    }
    return indices;
  }, [allItems]);

  useEffect(() => {
    dateSeparatorIndicesRef.current = dateSeparatorIndices;
    allItemsRef.current = allItems;
  }, [dateSeparatorIndices, allItems]);

  const handleScroll = useCallback(
    (offset: number) => {
      const handle = virtualizerRef.current;
      if (!handle) return;

      checkScrollTriggers(offset);
      handleScrollToBottom(offset);

      const distFromBottom = handle.scrollSize - offset - handle.viewportSize;
      if (!isFiltered && distFromBottom < 50 && chatId) {
        resetUnseenCount(chatId);
      }

      const topIndex = handle.findItemIndex(offset);
      const indices = dateSeparatorIndicesRef.current;
      let activeIdx = -1;
      for (let k = indices.length - 1; k >= 0; k--) {
        if (indices[k] <= topIndex) {
          activeIdx = indices[k];
          break;
        }
      }
      if (activeIdx >= 0) {
        const dateStr = (allItemsRef.current[activeIdx] as DateSeparator).date;
        const sepBottom =
          handle.getItemOffset(activeIdx) + handle.getItemSize(activeIdx);
        const isHidden = sepBottom <= offset;
        if (activeDateRef.current !== dateStr) {
          activeDateRef.current = dateStr;
          setStickyDate(dateStr);
        }
        setShowStickyDate(isHidden);
      } else {
        if (activeDateRef.current !== null) {
          activeDateRef.current = null;
          setStickyDate(null);
          setShowStickyDate(false);
        }
      }
    },
    [
      checkScrollTriggers,
      handleScrollToBottom,
      chatId,
      isFiltered,
      resetUnseenCount,
    ],
  );

  useEffect(() => {
    if (!allItems.length) return;
    if (jumpTriggeredRef.current || isJumpingToMessage) {
      prevPendingLen.current = pendingMessages.length;
      return;
    }
    if (jumpScrollJustCompleted.current) {
      jumpScrollJustCompleted.current = false;
      prevPendingLen.current = pendingMessages.length;
      return;
    }

    const userSentMessage = pendingMessages.length > prevPendingLen.current;

    if (shouldAutoScroll.current || userSentMessage) {
      if (userSentMessage) postJumpRef.current = false;
      requestAnimationFrame(() => {
        virtualizerRef.current?.scrollToIndex(allItems.length - 1, {
          align: "end",
        });
      });
    }

    prevPendingLen.current = pendingMessages.length;
  }, [messages, pendingMessages, allItems.length, shouldAutoScroll, jumpScrollJustCompleted, postJumpRef]);

  useEffect(() => {
    if (initialScrollDone.current || allItems.length === 0) return;
    if (jumpTriggeredRef.current || isJumpingToMessage || targetMessageId) {
      initialScrollDone.current = true;
      return;
    }

    requestAnimationFrame(() => {
      if (initialScrollDone.current) return;
      virtualizerRef.current?.scrollToIndex(allItems.length - 1, {
        align: "end",
      });
      initialScrollDone.current = true;
    });
  }, [allItems.length, isJumpingToMessage, targetMessageId]);

  useEffect(() => {
    if (!targetMessageId || !chatId) {
      jumpTriggeredRef.current = false;
      return;
    }

    const found = findTargetIndexInItems(allItemsRef.current, targetMessageId);
    if (found >= 0) {
      shouldAutoScroll.current = false;
      virtualizerRef.current?.scrollToIndex(found, { align: "center", smooth: true });
      highlightMessage(targetMessageId);
      jumpTriggeredRef.current = false;
      jumpScrollJustCompleted.current = true;
      postJumpRef.current = true;
      const url = new URL(window.location.href);
      if (url.searchParams.has("m")) {
        url.searchParams.delete("m");
        window.history.replaceState({}, "", url.pathname + url.search);
      }
      return;
    }

    jumpTriggeredRef.current = true;
    storeJumpToMessage(chatId, targetMessageId);
  }, [targetMessageId, chatId, storeJumpToMessage, highlightMessage, jumpScrollJustCompleted]);

  useEffect(() => {
    if (!jumpTriggeredRef.current || !targetMessageId) return;
    if (isJumpingToMessage) return;

    const found = findTargetIndexInItems(allItemsRef.current, targetMessageId);
    if (found >= 0) {
      shouldAutoScroll.current = false;
      virtualizerRef.current?.scrollToIndex(found, { align: "center", smooth: true });
      highlightMessage(targetMessageId);
      jumpTriggeredRef.current = false;
      jumpScrollJustCompleted.current = true;
      postJumpRef.current = true;

      const url = new URL(window.location.href);
      if (url.searchParams.has("m")) {
        url.searchParams.delete("m");
        window.history.replaceState({}, "", url.pathname + url.search);
      }
    }
  }, [messages, isJumpingToMessage, targetMessageId, highlightMessage, jumpScrollJustCompleted]);

  useEffect(() => {
    const senderIds = new Set<string>();
    for (const m of messages) {
      if (m.senderId) senderIds.add(m.senderId);
    }
    for (const m of pendingMessages) {
      if (m.senderId) senderIds.add(m.senderId);
    }
    if (senderIds.size > 0) {
      useProfiles.getState().ensureProfiles([...senderIds]);
    }
  }, [messages, pendingMessages]);

  useEffect(() => {
    if (allItems.length === 0) {
      prevItemCount.current = 0;
      prevPendingLen.current = 0;
      initialScrollDone.current = false;
      jumpTriggeredRef.current = false;
      pendingReplyJumpRef.current = null;
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
      clearHighlight();
      activeDateRef.current = null;
      startTransition(() => {
        setStickyDate(null);
        setShowStickyDate(false);
      });
      resetScrollToBottom();
    }
  }, [allItems.length, resetScrollToBottom, clearHighlight]);

  const handleOpenMedia = useCallback(
    (messageId: string, _mediaIndex: number) => {
      const sourceMsg = messages.find(
        (m) => m.id === messageId || m.pendingId === messageId
      ) || pendingMessages.find(
        (m) => m.id === messageId || m.pendingId === messageId
      );
      const globalIndex = sourceMsg
        ? findMediaMessageIndex(allMediaMessages, sourceMsg)
        : -1;

      setLightboxState({
        messages: allMediaMessages,
        initialIndex: globalIndex >= 0 ? globalIndex : 0,
      });
    },
    [allMediaMessages, messages, pendingMessages],
  );

  const handleOpenGroupLightbox = useCallback(
    (groupMessages: MessageType[], index: number) => {
      const selectedMessage = groupMessages[index];
      const globalIndex = selectedMessage
        ? findMediaMessageIndex(allMediaMessages, selectedMessage)
        : -1;

      setLightboxState({
        messages: allMediaMessages,
        initialIndex: globalIndex >= 0 ? globalIndex : 0,
      });
    },
    [allMediaMessages],
  );

  const getItemKey = useCallback((item: VirtualItem, index: number): string => {
    if (isLoadMoreItem(item)) return `__load_more__`;
    if (isLoadNewerItem(item)) return `__load_newer__`;
    if (isDateSeparator(item)) return `__date_${item.date}_${index}`;
    if (isTypingIndicator(item)) return "__typing_indicator__";
    if (isMediaGroupItem(item)) return `__group_${item.groupId}_${index}`;
    const msg = item as MessageType;
    return `${msg.id || msg.pendingId || "item"}-${index}`;
  }, []);

  const renderItem = useCallback(
    (item: VirtualItem): React.ReactNode => {
      if (isLoadMoreItem(item)) {
        return renderLoadMore();
      }

      if (isLoadNewerItem(item)) {
        return renderLoadNewer();
      }

      if (isDateSeparator(item)) {
        return (
          <div className="flex justify-center py-2">
            <span className="px-3 py-1 text-xs font-medium text-muted-foreground bg-background/95 backdrop-blur-sm rounded-full shadow-sm border border-border/50">
              {item.date}
            </span>
          </div>
        );
      }

      if (isTypingIndicator(item)) {
        return (
          <div className="flex justify-start px-4 pb-1" role="status" aria-live="polite" data-testid="chat-typing-indicator">
            <div className="max-w-[85%] rounded-bl-xl rounded-r-xl bg-muted px-3 py-2 text-sm text-muted-foreground shadow-sm">
              <div className="mb-1 flex items-center gap-1" aria-hidden="true">
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    className="size-1.5 animate-bounce rounded-full bg-muted-foreground motion-reduce:animate-none"
                    style={{ animationDelay: `${dot * 150}ms` }}
                  />
                ))}
              </div>
              <span>{item.text}</span>
            </div>
          </div>
        );
      }

      if (isMediaGroupItem(item)) {
        const representative = item.messages[0];
        return (
          <ChatBodyMessage
            message={representative}
            onReply={onReply}
            onOpenMedia={handleOpenMedia}
            onJumpToMessage={handleBubbleReplyJump}
            isHighlighted={
              highlightedMessageId !== null &&
              (representative.id === highlightedMessageId ||
                representative.pendingId === highlightedMessageId)
            }
            showSenderInfo={isGroup}
            mediaGroupMessages={item.messages}
            onOpenGroupLightbox={handleOpenGroupLightbox}
            isReadOnly={isFiltered}
          />
        );
      }

      if (item.type === "system") {
        return (
          <SystemMessage
            content={item.content}
            actorId={item.senderId}
            targetId={item.targetId}
            targetIds={item.targetIds}
          />
        );
      }

      const message = item as MessageType;
      const isPending = !!message.pendingId;
      const isHighlighted =
        highlightedMessageId !== null &&
        (message.id === highlightedMessageId ||
          message.pendingId === highlightedMessageId);

      return (
        <ChatBodyMessage
          message={message}
          onReply={onReply}
          onRetry={isPending ? onRetry : undefined}
          onOpenMedia={handleOpenMedia}
          onJumpToMessage={handleBubbleReplyJump}
          isHighlighted={isHighlighted}
          showSenderInfo={isGroup}
          isReadOnly={isFiltered}
        />
      );
    },
    [
      renderLoadMore,
      renderLoadNewer,
      onReply,
      handleOpenMedia,
      handleBubbleReplyJump,
      highlightedMessageId,
      isGroup,
      handleOpenGroupLightbox,
      onRetry,
      isFiltered,
    ],
  );

  if (allItems.length === 0) {
    return (
      <div className="relative flex min-h-0 w-full flex-1">
        <EmptyState title="Start a conversation" description="No messages yet. Send the first message" />
      </div>
    );
  }

  return (
    <div className="relative w-full flex-1 min-h-0">
      <ScrollArea viewPortRef={viewPortRef} className="w-full h-full px-3 py-2">
        {stickyDate && showStickyDate && (
          <div className="absolute top-2 left-0 right-0 z-10 flex justify-center pointer-events-none">
            <span
              key={stickyDate}
              className="px-3 py-1 text-xs font-medium text-muted-foreground bg-background/95 backdrop-blur-sm rounded-full shadow-sm border border-border/50"
            >
              {stickyDate}
            </span>
          </div>
        )}

        <div style={{ overflowAnchor: "none", display: "flex", flexDirection: "column", minHeight: "100%" }}>
          <div style={{ flexGrow: 1 }} />
          <Virtualizer
            ref={virtualizerRef}
            scrollRef={viewPortRef}
            data={allItems}
            shift={shouldShift}
            onScroll={handleScroll}
          >
            {(item, index) => {
              const key = getItemKey(item, index);
              return <div key={key}>{renderItem(item)}</div>;
            }}
          </Virtualizer>
        </div>
      </ScrollArea>

      {!isAtBottom && (
        <JumpToBottomButton
          unseenMessageCount={isFiltered ? 0 : unseenMessageCount}
          onClick={() => {
            if (isFiltered) {
              scrollToBottom();
              return;
            }
            if (chatId) {
              resetUnseenCount(chatId);
              resetScrollToBottom();
              jumpToLatestMessage(chatId);
            }
          }}
        />
      )}

      {isJumpingToMessage && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/60">
          <div className="flex flex-col items-center gap-2">
            <Spinner className="w-8 h-8" />
            <span className="text-sm text-muted-foreground">Jumping to message...</span>
          </div>
        </div>
      )}

      {lightboxState !== null &&
        lightboxState.messages.length > 0 &&
        createPortal(
          <MediaLightbox
            messages={lightboxState.messages}
            initialIndex={lightboxState.initialIndex}
            onClose={() => setLightboxState(null)}
          />,
          document.body,
        )}
    </div>
  );
};

export default ChatBody;
