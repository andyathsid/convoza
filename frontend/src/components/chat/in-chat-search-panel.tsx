"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { endOfDay, format, isSameDay, startOfDay } from "date-fns";
import { X, Search, ArrowLeft, Image as ImageIcon, Video, Music, FileText, CheckCheck, Check } from "lucide-react";
import { InstantSearch, useInfiniteHits, Highlight } from "react-instantsearch";
import type { Hit } from "instantsearch.js";
import type { SearchClient } from "instantsearch.js";
import { getSearchClient } from "@/lib/search-client";
import { useUIStore } from "@/stores/ui-store";
import { useAuth } from "@/stores/use-auth";
import { useProfiles } from "@/stores/use-profiles";
import { formatDateLabel, formatMessageTime } from "@/lib/helper";
import {
  buildEqualityFilter,
  buildNumericRangeFilter,
  combineFilters,
} from "@/lib/search-filters";
import type { MessageSearchDocument } from "@/types/search";
import { Input } from "@/components/ui/input";
import SearchQuerySync from "./search-query-sync";
import SearchConfigure from "./search-configure";
import SearchDatePicker, { type SearchDateRange } from "./search-date-picker";

interface Props {
  chatId: string;
  isGroup?: boolean;
  closeOnResultSelect?: boolean;
}

interface ResultGroup {
  dateLabel: string;
  results: MessageSearchDocument[];
}

function SearchResults({
  onHitClick,
  currentUserId,
  query,
  hasDateFilter,
}: {
  onHitClick: (messageId: string) => void;
  currentUserId?: string;
  query: string;
  hasDateFilter: boolean;
}) {
  const { items, isLastPage, showMore } = useInfiniteHits<MessageSearchDocument>();
  const getProfile = useProfiles((s) => s.getProfile);
  const ensureProfiles = useProfiles((s) => s.ensureProfiles);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLastPage) {
          showMore();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isLastPage, showMore]);

  useEffect(() => {
    const senderIds = items.map((h) => h.senderId).filter(Boolean);
    if (senderIds.length > 0) ensureProfiles(senderIds);
  }, [items, ensureProfiles]);

  const grouped = useMemo((): ResultGroup[] => {
    const groupsByDate = new Map<string, ResultGroup>();

    for (const hit of items) {
      const dateLabel = formatDateLabel(hit.createdAt);
      let group = groupsByDate.get(dateLabel);

      if (!group) {
        group = { dateLabel, results: [] };
        groupsByDate.set(dateLabel, group);
      }

      group.results.push(hit);
    }

    return Array.from(groupsByDate.values());
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <p className="text-sm text-muted-foreground">
          {query
            ? <>No results found for &ldquo;{query}&rdquo;</>
            : hasDateFilter
              ? "No messages found in the selected date range"
              : "No messages found"}
        </p>
      </div>
    );
  }

  return (
    <div className="py-2">
      <div className="px-4 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {items.length} {items.length === 1 ? "result" : "results"}
        </span>
      </div>
      {grouped.map((group) => (
        <div key={group.dateLabel}>
          <div className="px-4 py-1.5 sticky top-0 bg-card z-10">
            <span className="text-xs font-semibold text-primary">
              {group.dateLabel}
            </span>
          </div>
          {group.results.map((hit) => {
            const senderName = getProfile(hit.senderId)?.username || (hit.senderId === currentUserId ? "You" : "");
            return (
            <button
              key={hit.id}
              type="button"
              className="w-full flex flex-col gap-0.5 px-4 py-2 rounded-sm hover:bg-accent/30 transition-colors text-left cursor-pointer"
              onClick={() => onHitClick(hit.id)}
            >
              <div className="flex items-center gap-1 text-sm text-muted-foreground min-w-0">
                <span className="shrink-0 text-xs">
                  {currentUserId === hit.senderId ? (
                    hit.readBy && hit.readBy.length > 0 ? (
                      <CheckCheck className="h-3 w-3 text-blue-500" />
                    ) : hit.deliveredTo && hit.deliveredTo.length > 0 ? (
                      <CheckCheck className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <Check className="h-3 w-3 text-muted-foreground" />
                    )
                  ) : (
                    <span className="truncate max-w-[120px]">{senderName}:</span>
                  )}
                </span>
                {hit.mediaType === "document" ? (
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : hit.mediaType === "image" ? (
                  <ImageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : hit.mediaType === "video" ? (
                  <Video className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : hit.mediaType === "audio" ? (
                  <Music className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : null}
                {hit.mediaType && !hit.content ? (
                  <span className="text-sm truncate">
                    {hit.mediaType === "document" ? (hit.documentName || "Document") : hit.mediaType === "image" ? "Photo" : hit.mediaType === "video" ? "Video" : "Audio"}
                  </span>
                ) : (
                <Highlight hit={hit as unknown as Hit<MessageSearchDocument>} attribute="content" highlightedTagName="mark" classNames={{ root: "truncate min-w-0" }} />
                )}
                <span className="text-xs text-muted-foreground shrink-0 ml-auto">
                  {formatMessageTime(hit.createdAt)}
                </span>
              </div>
            </button>
            );
          })}
        </div>
      ))}
      {!isLastPage && <div ref={sentinelRef} className="h-4" />}
    </div>
  );
}

export default function InChatSearchPanel({ chatId, closeOnResultSelect = false }: Props) {
  const {
    setActiveChatContentPanel,
    setSearchJumpTargetId,
    searchOrigin,
    inChatMessageFilter,
    setInChatMessageFilter,
  } = useUIStore();
  const currentUserId = useAuth((s) => s.user?.id);
  const initialFilter =
    inChatMessageFilter?.chatId === chatId
      ? inChatMessageFilter
      : null;
  const [query, setQuery] = useState(initialFilter?.query ?? "");
  const [selectedDateRange, setSelectedDateRange] = useState<
    SearchDateRange | undefined
  >(() =>
    initialFilter?.fromMs !== undefined
      ? {
          from: new Date(initialFilter.fromMs),
          to:
            initialFilter.toMs !== undefined
              ? new Date(initialFilter.toMs)
              : undefined,
        }
      : undefined
  );
  const [client, setClient] = useState<SearchClient | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    getSearchClient().then(setClient);
  }, []);

  const handleBack = useCallback(() => {
    setActiveChatContentPanel(searchOrigin === "search" ? "none" : searchOrigin);
  }, [searchOrigin, setActiveChatContentPanel]);

  const handleSelect = useCallback(
    (messageId: string) => {
      setSearchJumpTargetId(messageId);
      if (closeOnResultSelect) setActiveChatContentPanel("none");
    },
    [
      closeOnResultSelect,
      setActiveChatContentPanel,
      setSearchJumpTargetId,
    ]
  );

  const updateSharedFilter = useCallback(
    (nextQuery: string, nextRange?: SearchDateRange) => {
      const trimmedQuery = nextQuery.trim();
      if (!trimmedQuery && !nextRange) {
        setInChatMessageFilter(null);
        return;
      }

      setInChatMessageFilter({
        chatId,
        query: trimmedQuery,
        ...(nextRange
          ? {
              fromMs: startOfDay(nextRange.from).getTime(),
              toMs: endOfDay(nextRange.to ?? nextRange.from).getTime(),
            }
          : {}),
      });
    },
    [chatId, setInChatMessageFilter]
  );

  const handleQueryChange = useCallback(
    (nextQuery: string) => {
      setQuery(nextQuery);
      updateSharedFilter(nextQuery, selectedDateRange);
    },
    [selectedDateRange, updateSharedFilter]
  );

  const handleDateRangeChange = useCallback(
    (nextRange?: SearchDateRange) => {
      setSelectedDateRange(nextRange);
      updateSharedFilter(query, nextRange);
    },
    [query, updateSharedFilter]
  );

  const trimmedQuery = query.trim();
  const dateFilter = selectedDateRange
    ? buildNumericRangeFilter(
        "createdAt",
        startOfDay(selectedDateRange.from).getTime(),
        endOfDay(selectedDateRange.to ?? selectedDateRange.from).getTime()
      )
    : undefined;
  const filters = combineFilters(buildEqualityFilter("chatId", chatId), dateFilter);
  const hasSearchCriteria = Boolean(trimmedQuery || selectedDateRange);

  return (
    <div className="flex flex-col h-full bg-card select-none">
      {/* Header */}
      <div className="h-14 px-4 flex items-center gap-1 border-b border-border bg-card shrink-0">
        <button
          type="button"
          className="h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-foreground rounded-full hover:bg-accent/50 transition-colors cursor-pointer"
          onClick={handleBack}
          aria-label="Back to info"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h3 className="font-semibold text-base">Search messages</h3>
      </div>

      {/* Search input */}
      <div className="px-4 py-3 border-b border-border">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <SearchDatePicker
              value={selectedDateRange}
              onChange={handleDateRangeChange}
            />
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={inputRef}
                type="text"
                placeholder="Search"
                value={query}
                onChange={(e) => handleQueryChange(e.target.value)}
                className="h-12 rounded-2xl border-none bg-muted/50 pl-9 pr-9 text-sm shadow-none"
              />
              {query && (
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => handleQueryChange("")}
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {selectedDateRange ? (
            <div className="inline-flex h-8 items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-3 text-xs font-medium text-primary">
              <span>
                {selectedDateRange.to &&
                !isSameDay(selectedDateRange.from, selectedDateRange.to)
                  ? `${format(selectedDateRange.from, "MMM d, yyyy")} - ${format(selectedDateRange.to, "MMM d, yyyy")}`
                  : format(selectedDateRange.from, "MMM d, yyyy")}
              </span>
              <button
                type="button"
                onClick={() => handleDateRangeChange(undefined)}
                className="rounded-full p-0.5 text-primary/75 transition-colors hover:bg-primary/12 hover:text-primary"
                aria-label="Clear selected date"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!hasSearchCriteria ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <Search className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground">
              Search for messages in this chat
            </p>
          </div>
        ) : client ? (
          <InstantSearch searchClient={client} indexName="messages">
            <SearchQuerySync query={trimmedQuery} />
            <SearchConfigure filters={filters} hitsPerPage={20} />
            <SearchResults
              onHitClick={handleSelect}
              currentUserId={currentUserId}
              query={trimmedQuery}
              hasDateFilter={Boolean(selectedDateRange)}
            />
          </InstantSearch>
        ) : null}
      </div>
    </div>
  );
}
