"use client";

import { useEffect, useRef, useCallback, useMemo, useState } from "react";
import type { VirtualizerHandle } from "virtua";
import { Spinner } from "@/components/ui/spinner";
import type {
  LoadMoreItem,
  LoadNewerItem,
  VirtualItem,
} from "../types/virtual-item";

export type { LoadMoreItem, LoadNewerItem } from "../types/virtual-item";

export function isLoadMoreItem(item: VirtualItem): item is LoadMoreItem {
  return (item as LoadMoreItem).type === "load-more";
}

export function isLoadNewerItem(item: VirtualItem): item is LoadNewerItem {
  return (item as LoadNewerItem).type === "load-newer";
}

export interface UseChatPaginationOptions {
  hasMoreMessages: boolean;
  isLoadingMore: boolean;
  onLoadMore?: () => void;
  hasNewerMessages: boolean;
  isLoadingNewer: boolean;
  onLoadNewer?: () => void;
  virtualizerRef: React.RefObject<VirtualizerHandle | null>;
}

export interface UseChatPaginationReturn {
  shouldShift: boolean;
  prependItem: LoadMoreItem | null;
  appendItem: LoadNewerItem | null;
  checkScrollTriggers: (offset: number) => void;
  renderLoadMore: () => React.ReactNode;
  renderLoadNewer: () => React.ReactNode;
}

export function useChatPagination({
  hasMoreMessages,
  isLoadingMore,
  onLoadMore,
  hasNewerMessages,
  isLoadingNewer,
  onLoadNewer,
  virtualizerRef,
}: UseChatPaginationOptions): UseChatPaginationReturn {
  const [shouldShift, setShouldShift] = useState(false);
  const prevIsLoadingMore = useRef(isLoadingMore);

  useEffect(() => {
    if (prevIsLoadingMore.current && !isLoadingMore) {
      setShouldShift(false);
    }
    prevIsLoadingMore.current = isLoadingMore;
  }, [isLoadingMore]);

  const checkScrollTriggers = useCallback(
    (offset: number) => {
      const handle = virtualizerRef.current;
      if (!handle) return;

      if (offset < 100 && hasMoreMessages && !isLoadingMore && onLoadMore) {
        setShouldShift(true);
        onLoadMore();
      }

      const distFromBottom = handle.scrollSize - offset - handle.viewportSize;
      if (distFromBottom < 200 && hasNewerMessages && !isLoadingNewer && onLoadNewer) {
        onLoadNewer();
      }
    },
    [hasMoreMessages, isLoadingMore, onLoadMore, hasNewerMessages, isLoadingNewer, onLoadNewer, virtualizerRef],
  );

  const prependItem = useMemo<LoadMoreItem | null>(
    () => (hasMoreMessages ? { type: "load-more" } : null),
    [hasMoreMessages],
  );

  const appendItem = useMemo<LoadNewerItem | null>(
    () => (hasNewerMessages ? { type: "load-newer" } : null),
    [hasNewerMessages],
  );

  const renderLoadMore = useCallback(
    () => (
      <div className="flex justify-center py-2">
        {isLoadingMore ? (
          <Spinner className="w-5 h-5" />
        ) : (
          <button
            onClick={onLoadMore}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1 rounded-full hover:bg-accent"
          >
            Load older messages
          </button>
        )}
      </div>
    ),
    [isLoadingMore, onLoadMore],
  );

  const renderLoadNewer = useCallback(
    () => (
      <div className="flex justify-center py-2">
        {isLoadingNewer ? (
          <Spinner className="w-5 h-5" />
        ) : (
          <button
            onClick={onLoadNewer}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1 rounded-full hover:bg-accent"
          >
            Load newer messages
          </button>
        )}
      </div>
    ),
    [isLoadingNewer, onLoadNewer],
  );

  return {
    shouldShift,
    prependItem,
    appendItem,
    checkScrollTriggers,
    renderLoadMore,
    renderLoadNewer,
  };
}
