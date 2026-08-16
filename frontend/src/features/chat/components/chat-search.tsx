"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  Index,
  InstantSearch,
  useInfiniteHits,
  useInstantSearch,
} from "react-instantsearch";
import type { Hit, SearchClient } from "instantsearch.js";
import { Virtualizer } from "virtua";
import { getSearchClient } from "@/features/chat/lib/search-client";
import { buildEqualityFilter } from "@/features/chat/lib/search-filters";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth";
import { useChatStore } from "@/features/chat/stores/chat-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import ChatHit from "./chat-hit";
import ContactHit from "./contact-hit";
import GroupHit from "./group-hit";
import MessageHit from "./message-hit";
import SearchQuerySync from "./search-query-sync";
import SearchConfigure from "./search-configure";
import type {
  ChatSearchDocument,
  ContactSearchDocument,
  GroupSearchDocument,
  MessageSearchDocument,
} from "@/features/chat/types/search";

interface ChatSearchProps {
  query: string;
  onHitClick: (chatId: string, messageId?: string, userId?: string) => void;
}

type SearchCategory = "all" | "chats" | "contacts" | "groups" | "messages";
type ResultCategory = Exclude<SearchCategory, "all">;
type SearchDocument =
  | ChatSearchDocument
  | ContactSearchDocument
  | GroupSearchDocument
  | MessageSearchDocument;
type SearchHit = Hit<SearchDocument>;

interface CollectionState {
  visibleCount: number;
  settled: boolean;
}

interface VirtualHitItem {
  type: "hit";
  hit: SearchHit;
}

interface VirtualLoadMoreItem {
  type: "load-more";
}

type VirtualSearchItem = VirtualHitItem | VirtualLoadMoreItem;

const RESULT_CATEGORIES: ResultCategory[] = [
  "chats",
  "contacts",
  "groups",
  "messages",
];

const CATEGORY_LABELS: Record<SearchCategory, string> = {
  all: "All",
  chats: "Chats",
  contacts: "Contacts",
  groups: "Groups",
  messages: "Messages",
};

const SECTION_LABELS: Record<ResultCategory, string> = {
  chats: "Chats",
  contacts: "Contacts",
  groups: "Groups in common",
  messages: "Messages",
};

function isSearchPending(status: string): boolean {
  return status === "loading" || status === "stalled";
}

function SearchResultRow({
  category,
  hit,
  query,
  onHitClick,
}: {
  category: ResultCategory;
  hit: SearchHit;
  query: string;
  onHitClick: ChatSearchProps["onHitClick"];
}) {
  const currentUserId = useAuth((state) => state.user?.id);
  const metadata = useChatStore((state) => state.searchChatMetadata);
  const chats = useChatStore((state) => state.chats);

  switch (category) {
    case "chats":
      return (
        <ChatHit
          hit={hit as Hit<ChatSearchDocument>}
          currentUserId={currentUserId}
          query={query}
          onHitClick={(chatId) => onHitClick(chatId)}
        />
      );
    case "contacts":
      return (
        <ContactHit
          hit={hit as Hit<ContactSearchDocument>}
          onHitClick={onHitClick}
        />
      );
    case "groups": {
      const groupHit = hit as Hit<GroupSearchDocument>;
      const loaded = chats.find((chat) => chat.id === groupHit.id);
      const resolvedMetadata = loaded
        ? {
            groupName: loaded.groupName,
            groupAvatar: loaded.groupAvatar || "",
          }
        : metadata.get(groupHit.id);

      return (
        <GroupHit
          hit={groupHit}
          metadata={resolvedMetadata}
          onHitClick={(chatId) => onHitClick(chatId)}
          query={query}
        />
      );
    }
    case "messages":
      return (
        <MessageHit
          hit={hit as Hit<MessageSearchDocument>}
          onHitClick={(chatId, messageId) => onHitClick(chatId, messageId)}
          currentUserId={currentUserId}
        />
      );
  }
}

function LoadMoreSentinel({
  loading,
  onVisible,
}: {
  loading: boolean;
  onVisible: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = sentinelRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onVisible();
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [onVisible]);

  return (
    <div ref={sentinelRef} className="flex h-12 items-center justify-center">
      {loading && <Spinner className="h-5 w-5" />}
    </div>
  );
}

function SearchCollection({
  category,
  mode,
  query,
  excludeContactIds,
  scrollRef,
  onHitClick,
  onSeeAll,
  onStateChange,
}: {
  category: ResultCategory;
  mode: "preview" | "full";
  query: string;
  excludeContactIds: Set<string>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onHitClick: ChatSearchProps["onHitClick"];
  onSeeAll?: (category: ResultCategory) => void;
  onStateChange?: (category: ResultCategory, state: CollectionState) => void;
}) {
  const { items, results, isLastPage, showMore } =
    useInfiniteHits<SearchDocument>();
  const { status } = useInstantSearch();
  const currentUserId = useAuth((state) => state.user?.id);
  const ensureMetadata = useChatStore(
    (state) => state.ensureSearchChatMetadata,
  );
  const lastRequestedItemCount = useRef(-1);
  const rawItems = items as SearchHit[];
  const querySettled = results?.query === query;
  const loading = isSearchPending(status);

  const visibleItems = useMemo(() => {
    if (category !== "contacts") return rawItems;

    return rawItems.filter(
      (hit) => !excludeContactIds.has(hit.id) && hit.id !== currentUserId,
    );
  }, [category, currentUserId, excludeContactIds, rawItems]);

  const previewItems = useMemo(
    () => visibleItems.slice(0, 20),
    [visibleItems],
  );

  useEffect(() => {
    if (category !== "groups" || rawItems.length === 0) return;
    ensureMetadata(rawItems.map((hit) => hit.id));
  }, [category, ensureMetadata, rawItems]);

  const requestNextPage = useCallback(() => {
    if (!querySettled || loading || isLastPage) return;
    if (lastRequestedItemCount.current === rawItems.length) return;

    lastRequestedItemCount.current = rawItems.length;
    showMore();
  }, [isLastPage, loading, querySettled, rawItems.length, showMore]);

  // Contacts are filtered after search, so an excluded first page must not hide
  // valid contacts that exist on a later page.
  useEffect(() => {
    if (
      mode === "preview" &&
      category === "contacts" &&
      querySettled &&
      visibleItems.length === 0 &&
      !isLastPage
    ) {
      requestNextPage();
    }
  }, [
    category,
    isLastPage,
    mode,
    querySettled,
    requestNextPage,
    visibleItems.length,
  ]);

  const seekingVisibleContact =
    mode === "preview" &&
    category === "contacts" &&
    querySettled &&
    visibleItems.length === 0 &&
    !isLastPage;

  useEffect(() => {
    onStateChange?.(category, {
      visibleCount: querySettled ? previewItems.length : 0,
      settled: querySettled && !loading && !seekingVisibleContact,
    });
  }, [
    category,
    loading,
    onStateChange,
    previewItems.length,
    querySettled,
    seekingVisibleContact,
  ]);

  if (mode === "preview") {
    if (!querySettled || previewItems.length === 0) return null;

    const displayedItems =
      category === "messages" ? visibleItems : previewItems;

    return (
      <section aria-labelledby={`search-${category}-heading`}>
        <div className="flex items-center justify-between px-2 pb-1 pt-4">
          <h2
            id={`search-${category}-heading`}
            className="text-xs font-medium text-muted-foreground"
          >
            {SECTION_LABELS[category]}
          </h2>
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline"
            onClick={() => onSeeAll?.(category)}
          >
            See all
          </button>
        </div>
        {displayedItems.map((hit) => (
          <SearchResultRow
            key={`${category}-${hit.id}`}
            category={category}
            hit={hit}
            query={query}
            onHitClick={onHitClick}
          />
        ))}
        {category === "messages" && !isLastPage && (
          <LoadMoreSentinel
            loading={loading}
            onVisible={requestNextPage}
          />
        )}
      </section>
    );
  }

  if (!querySettled) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (visibleItems.length === 0 && isLastPage) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        No {CATEGORY_LABELS[category].toLowerCase()} found
      </div>
    );
  }

  const virtualItems: VirtualSearchItem[] = visibleItems.map((hit) => ({
    type: "hit",
    hit,
  }));
  if (!isLastPage) virtualItems.push({ type: "load-more" });

  return (
    <Virtualizer scrollRef={scrollRef} data={virtualItems}>
      {(item) => {
        if (item.type === "load-more") {
          return (
            <LoadMoreSentinel
              key="load-more"
              loading={loading}
              onVisible={requestNextPage}
            />
          );
        }

        return (
          <div key={`${category}-${item.hit.id}`}>
            <SearchResultRow
              category={category}
              hit={item.hit}
              query={query}
              onHitClick={onHitClick}
            />
          </div>
        );
      }}
    </Virtualizer>
  );
}

function CollectionIndex({
  category,
  mode,
  query,
  membershipFilter,
  excludeContactIds,
  scrollRef,
  onHitClick,
  onSeeAll,
  onStateChange,
}: {
  category: ResultCategory;
  mode: "preview" | "full";
  query: string;
  membershipFilter: string;
  excludeContactIds: Set<string>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onHitClick: ChatSearchProps["onHitClick"];
  onSeeAll?: (category: ResultCategory) => void;
  onStateChange?: (category: ResultCategory, state: CollectionState) => void;
}) {
  const filters = category === "contacts" ? undefined : membershipFilter;

  return (
    <Index indexName={category}>
      <SearchQuerySync query={query} />
      <SearchConfigure
        filters={filters}
        hitsPerPage={mode === "preview" ? 20 : 100}
      />
      <SearchCollection
        category={category}
        mode={mode}
        query={query}
        excludeContactIds={excludeContactIds}
        scrollRef={scrollRef}
        onHitClick={onHitClick}
        onSeeAll={onSeeAll}
        onStateChange={onStateChange}
      />
    </Index>
  );
}

function AllCollections({
  query,
  membershipFilter,
  excludeContactIds,
  scrollRef,
  onHitClick,
  onSeeAll,
}: {
  query: string;
  membershipFilter: string;
  excludeContactIds: Set<string>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onHitClick: ChatSearchProps["onHitClick"];
  onSeeAll: (category: ResultCategory) => void;
}) {
  const [collectionStates, setCollectionStates] = useState<
    Record<ResultCategory, CollectionState>
  >({
    chats: { visibleCount: 0, settled: false },
    contacts: { visibleCount: 0, settled: false },
    groups: { visibleCount: 0, settled: false },
    messages: { visibleCount: 0, settled: false },
  });

  const handleStateChange = useCallback(
    (category: ResultCategory, nextState: CollectionState) => {
      setCollectionStates((current) => {
        const previous = current[category];
        if (
          previous.visibleCount === nextState.visibleCount &&
          previous.settled === nextState.settled
        ) {
          return current;
        }
        return { ...current, [category]: nextState };
      });
    },
    [],
  );

  const allSettled = RESULT_CATEGORIES.every(
    (category) => collectionStates[category].settled,
  );
  const totalVisible = RESULT_CATEGORIES.reduce(
    (total, category) => total + collectionStates[category].visibleCount,
    0,
  );

  return (
    <>
      {RESULT_CATEGORIES.map((category) => (
        <CollectionIndex
          key={category}
          category={category}
          mode="preview"
          query={query}
          membershipFilter={membershipFilter}
          excludeContactIds={excludeContactIds}
          scrollRef={scrollRef}
          onHitClick={onHitClick}
          onSeeAll={onSeeAll}
          onStateChange={handleStateChange}
        />
      ))}
      {!allSettled && totalVisible === 0 && (
        <div className="flex items-center justify-center py-8">
          <Spinner className="h-6 w-6" />
        </div>
      )}
      {allSettled && totalVisible === 0 && (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          No results found
        </div>
      )}
    </>
  );
}

function CategoryFilters({
  activeCategory,
  onChange,
}: {
  activeCategory: SearchCategory;
  onChange: (category: SearchCategory) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<SearchCategory, HTMLButtonElement | null>>({
    all: null,
    chats: null,
    contacts: null,
    groups: null,
    messages: null,
  });
  const dragStartRef = useRef({ pointerId: -1, x: 0, scrollLeft: 0 });
  const suppressClickRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    buttonRefs.current[activeCategory]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeCategory]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;

    dragStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      scrollLeft: viewportRef.current?.scrollLeft || 0,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragStart = dragStartRef.current;
    if (dragStart.pointerId !== event.pointerId || !viewportRef.current) return;

    const distance = event.clientX - dragStart.x;
    if (!isDragging && Math.abs(distance) < 4) return;

    if (!isDragging) {
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
      suppressClickRef.current = true;
    }

    event.preventDefault();
    viewportRef.current.scrollLeft = dragStart.scrollLeft - distance;
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current.pointerId !== event.pointerId) return;

    dragStartRef.current.pointerId = -1;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);

    // Click fires immediately after pointerup, then suppression can safely reset.
    requestAnimationFrame(() => {
      suppressClickRef.current = false;
    });
  };

  const handleClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  };

  return (
    <div className="min-w-0 shrink-0 border-b border-border bg-sidebar">
      <ScrollArea
        viewPortRef={viewportRef}
        className="w-full min-w-0"
        scrollBarOrientation="horizontal"
        viewPortClassName={cn(
          "cursor-grab overflow-y-hidden select-none",
          isDragging && "cursor-grabbing",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onClickCapture={handleClickCapture}
      >
        <div
          className="flex min-w-full gap-1.5 px-2 pb-3 pt-2"
          aria-label="Search result category"
        >
          {(["all", ...RESULT_CATEGORIES] as SearchCategory[]).map(
            (category) => (
              <button
                key={category}
                ref={(node) => {
                  buttonRefs.current[category] = node;
                }}
                type="button"
                aria-pressed={activeCategory === category}
                onClick={() => onChange(category)}
                className={cn(
                  "min-w-24 flex-1 shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                  activeCategory === category
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {CATEGORY_LABELS[category]}
              </button>
            ),
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default function ChatSearch({ query, onHitClick }: ChatSearchProps) {
  const [client, setClient] = useState<SearchClient | null>(null);
  const [activeCategory, setActiveCategory] =
    useState<SearchCategory>("all");
  const viewportRef = useRef<HTMLDivElement>(null);
  const chats = useChatStore((state) => state.chats);
  const currentUserId = useAuth((state) => state.user?.id);

  const excludedContactIds = useMemo(
    () =>
      new Set(
        chats
          .filter((chat) => !chat.isGroup)
          .flatMap((chat) => chat.participants.map((participant) => participant.id)),
      ),
    [chats],
  );

  useEffect(() => {
    getSearchClient().then(setClient);
  }, []);

  useEffect(() => {
    viewportRef.current?.scrollTo({ top: 0 });
  }, [activeCategory, query]);

  if (!client || !currentUserId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const membershipFilter = buildEqualityFilter("participants", currentUserId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CategoryFilters
        activeCategory={activeCategory}
        onChange={setActiveCategory}
      />
      <ScrollArea
        viewPortRef={viewportRef}
        className="min-h-0 flex-1"
        viewPortClassName="overflow-x-hidden"
      >
        <div className="px-2 pb-10 pt-1">
          <InstantSearch
            key={activeCategory}
            searchClient={client}
            indexName={activeCategory === "all" ? "chats" : activeCategory}
          >
            {activeCategory === "all" ? (
              <AllCollections
                query={query}
                membershipFilter={membershipFilter}
                excludeContactIds={excludedContactIds}
                scrollRef={viewportRef}
                onHitClick={onHitClick}
                onSeeAll={setActiveCategory}
              />
            ) : (
              <CollectionIndex
                category={activeCategory}
                mode="full"
                query={query}
                membershipFilter={membershipFilter}
                excludeContactIds={excludedContactIds}
                scrollRef={viewportRef}
                onHitClick={onHitClick}
              />
            )}
          </InstantSearch>
        </div>
      </ScrollArea>
    </div>
  );
}
