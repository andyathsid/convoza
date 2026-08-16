"use client";

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import type { VirtualizerHandle } from "virtua";
import type { MessageType } from "@/types";
import type { VirtualItem } from "../components/chat/chat-body";

interface UseJumpToMessageOptions {
  virtualizerRef: React.RefObject<VirtualizerHandle | null>;
  allItemsRef: React.RefObject<VirtualItem[]>;
  shouldAutoScroll: React.MutableRefObject<boolean>;
  hasMoreMessages: boolean;
  onLoadMore?: () => void;
  chatId: string | null;
  storeJumpToMessage: (chatId: string, messageId: string) => Promise<number | null>;
  findTargetIndex: (items: VirtualItem[], targetId: string) => number;
  getStoreState: () => { hasMoreMessages: boolean; isLoadingMoreMessages: boolean };
}

interface UseJumpToMessageReturn {
  highlightedMessageId: string | null;
  setHighlightedMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  jumpToMessage: (targetId: string) => Promise<void>;
  jumpScrollJustCompleted: React.MutableRefObject<boolean>;
  clearHighlight: () => void;
  highlightMessage: (messageId: string) => void;
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function waitForLoadComplete(isLoadingMore: boolean, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (!isLoadingMore) {
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

export function useJumpToMessage({
  virtualizerRef,
  allItemsRef,
  shouldAutoScroll,
  hasMoreMessages,
  onLoadMore,
  chatId,
  storeJumpToMessage,
  findTargetIndex,
  getStoreState,
}: UseJumpToMessageOptions): UseJumpToMessageReturn {
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpScrollJustCompleted = useRef(false);

  const clearHighlight = useCallback(() => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    setHighlightedMessageId(null);
  }, []);

  const jumpToMessage = useCallback(async (targetId: string) => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    setHighlightedMessageId(null);

    const scrollToTarget = (index: number) => {
      shouldAutoScroll.current = false;
      virtualizerRef.current?.scrollToIndex(index, { align: "center", smooth: true });
      setHighlightedMessageId(targetId);
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedMessageId(null);
        highlightTimerRef.current = null;
      }, 1500);
    };

    let foundIndex = findTargetIndex(allItemsRef.current, targetId);
    if (foundIndex >= 0) {
      scrollToTarget(foundIndex);
      return;
    }

    const MAX_LOAD_ATTEMPTS = 10;
    let attempts = 0;

    if (hasMoreMessages) {
      shouldAutoScroll.current = false;
      virtualizerRef.current?.scrollToIndex(0, { align: "start", smooth: true });
      await waitForAnimationFrame();
    }

    while (attempts < MAX_LOAD_ATTEMPTS) {
      const storeState = getStoreState();
      if (!storeState.hasMoreMessages) break;

      if (storeState.isLoadingMoreMessages) {
        await waitForLoadComplete(storeState.isLoadingMoreMessages, 5000);
        await waitForAnimationFrame();
        foundIndex = findTargetIndex(allItemsRef.current, targetId);
        if (foundIndex >= 0) { scrollToTarget(foundIndex); return; }
        continue;
      }

      attempts++;
      onLoadMore?.();
      await waitForLoadComplete(false, 5000);
      await waitForAnimationFrame();

      foundIndex = findTargetIndex(allItemsRef.current, targetId);
      if (foundIndex >= 0) { scrollToTarget(foundIndex); return; }
    }

    if (chatId) {
      const targetIdx = await storeJumpToMessage(chatId, targetId);
      if (targetIdx !== null && targetIdx >= 0) {
        await waitForAnimationFrame();
        await waitForAnimationFrame();
        foundIndex = findTargetIndex(allItemsRef.current, targetId);
        if (foundIndex >= 0) { scrollToTarget(foundIndex); return; }
      }
    }

    toast.error("Original message not found");
  }, [virtualizerRef, allItemsRef, shouldAutoScroll, hasMoreMessages, onLoadMore, chatId, storeJumpToMessage, findTargetIndex, getStoreState]);

  const highlightMessage = useCallback((messageId: string) => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    setHighlightedMessageId(messageId);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedMessageId(null);
      highlightTimerRef.current = null;
    }, 1500);
  }, []);

  return {
    highlightedMessageId,
    setHighlightedMessageId,
    jumpToMessage,
    jumpScrollJustCompleted,
    clearHighlight,
    highlightMessage,
  };
}
