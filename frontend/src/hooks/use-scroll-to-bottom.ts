"use client";

import { useState, useCallback, useRef } from "react";
import type { VirtualizerHandle } from "virtua";

interface UseScrollToBottomOptions {
  virtualizerRef: React.RefObject<VirtualizerHandle | null>;
  itemCount: number;
  postJumpRef?: React.MutableRefObject<boolean>;
}

interface UseScrollToBottomReturn {
  isAtBottom: boolean;
  scrollToBottom: () => void;
  handleScroll: (offset: number) => void;
  reset: () => void;
  shouldAutoScroll: React.MutableRefObject<boolean>;
}

export function useScrollToBottom({
  virtualizerRef,
  itemCount,
  postJumpRef,
}: UseScrollToBottomOptions): UseScrollToBottomReturn {
  const [isAtBottom, setIsAtBottom] = useState(true);
  const shouldAutoScroll = useRef(true);

  const scrollToBottom = useCallback(() => {
    virtualizerRef.current?.scrollToIndex(itemCount - 1, {
      align: "end",
      smooth: true,
    });
    setIsAtBottom(true);
    shouldAutoScroll.current = true;
    if (postJumpRef) postJumpRef.current = false;
  }, [virtualizerRef, itemCount, postJumpRef]);

  const handleScroll = useCallback(
    (offset: number) => {
      const handle = virtualizerRef.current;
      if (!handle) return;

      const distFromBottom = handle.scrollSize - offset - handle.viewportSize;
      const atBottom = distFromBottom < 50;
      // Don't re-enable auto-scroll after a jump until user explicitly requests it
      if (postJumpRef?.current) {
        setIsAtBottom(atBottom);
      } else {
        shouldAutoScroll.current = atBottom;
        setIsAtBottom(atBottom);
      }
    },
    [virtualizerRef, postJumpRef],
  );

  const reset = useCallback(() => {
    setIsAtBottom(true);
    shouldAutoScroll.current = true;
    if (postJumpRef) postJumpRef.current = false;
  }, [postJumpRef]);

  return {
    isAtBottom,
    scrollToBottom,
    handleScroll,
    reset,
    shouldAutoScroll,
  };
}
