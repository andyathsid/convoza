"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Timestamp,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentSnapshot,
} from "firebase/firestore";
import type { SearchClient } from "instantsearch.js";

import { db } from "@/lib/firebase";
import {
  markMessagesAsRead,
  markMessagesDelivered,
} from "@/features/chat/api/read-receipts";
import {
  getChronologicalMessageIndexName,
  getSearchClient,
} from "@/features/chat/lib/search-client";
import { normalizeChatDate } from "@/features/chat/lib/helper";
import {
  buildEqualityFilter,
  buildNumericRangeFilter,
  combineFilters,
} from "@/features/chat/lib/search-filters";
import type { FirestoreMessage } from "@/features/chat/types/chat";
import type { MessageSearchDocument } from "@/features/chat/types/search";
import type { InChatMessageFilter } from "@/features/chat/stores/ui-store";

const FILTER_PAGE_SIZE = 30;
const QUERY_DEBOUNCE_MS = 250;

interface FilteredMessagesState {
  messages: FirestoreMessage[];
  isInitialLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  error: string | null;
}

interface SearchPageResult {
  hits: MessageSearchDocument[];
  hasMore: boolean;
}

function getCreatedAtMs(message: FirestoreMessage): number {
  return normalizeChatDate(message.createdAt)?.getTime() ?? 0;
}

function mergeChronologically(
  existing: FirestoreMessage[],
  incoming: FirestoreMessage[]
): FirestoreMessage[] {
  const byId = new Map<string, FirestoreMessage>();

  for (const message of [...existing, ...incoming]) {
    if (message.id) byId.set(message.id, message);
  }

  return Array.from(byId.values()).sort(
    (left, right) => getCreatedAtMs(left) - getCreatedAtMs(right)
  );
}

async function hydrateMessageIds(
  chatId: string,
  messageIds: string[]
): Promise<FirestoreMessage[]> {
  if (!db || messageIds.length === 0) return [];

  const snapshot = await getDocs(
    query(
      collection(db, "chats", chatId, "messages"),
      where(documentId(), "in", messageIds.slice(0, FILTER_PAGE_SIZE))
    )
  );

  return snapshot.docs.map(
    (messageDoc) =>
      ({ id: messageDoc.id, ...messageDoc.data() }) as FirestoreMessage
  );
}

async function searchMessagePage(
  client: SearchClient,
  filter: InChatMessageFilter,
  page: number
): Promise<SearchPageResult> {
  const dateFilter =
    filter.fromMs !== undefined && filter.toMs !== undefined
      ? buildNumericRangeFilter("createdAt", filter.fromMs, filter.toMs)
      : undefined;
  const filters = combineFilters(
    buildEqualityFilter("chatId", filter.chatId),
    dateFilter
  );
  const response = await client.search([
    {
      indexName: getChronologicalMessageIndexName(),
      params: {
        query: filter.query,
        filters,
        hitsPerPage: FILTER_PAGE_SIZE,
        page,
      },
    },
  ]);
  const result = response.results[0];
  const hits = "hits" in result
    ? (result.hits as unknown as MessageSearchDocument[])
    : [];
  const resultPage = ("page" in result ? result.page : undefined) ?? page;
  const pageCount =
    ("nbPages" in result ? result.nbPages : undefined) ?? resultPage + 1;

  return {
    hits,
    hasMore: resultPage + 1 < pageCount,
  };
}

export function useFilteredChatMessages(
  filter: InChatMessageFilter | null,
  currentUserId: string | null
) {
  const [debouncedQuery, setDebouncedQuery] = useState(filter?.query ?? "");
  const [state, setState] = useState<FilteredMessagesState>({
    messages: [],
    isInitialLoading: false,
    isLoadingMore: false,
    hasMore: false,
    error: null,
  });
  const requestVersionRef = useRef(0);
  const pageRef = useRef(0);
  const cursorRef = useRef<DocumentSnapshot | null>(null);
  const loadingRef = useRef(false);
  const deliveredRef = useRef(new Set<string>());
  const readRef = useRef(new Set<string>());

  const filterQuery = filter?.query ?? "";

  useEffect(() => {
    if (!filterQuery) {
      setDebouncedQuery("");
      return;
    }

    const timer = window.setTimeout(
      () => setDebouncedQuery(filterQuery),
      QUERY_DEBOUNCE_MS
    );
    return () => window.clearTimeout(timer);
  }, [filterQuery]);

  const isQuerySettled = filterQuery === debouncedQuery;
  const effectiveFilter = filter && isQuerySettled
    ? { ...filter, query: debouncedQuery.trim() }
    : null;
  const filterKey = effectiveFilter
    ? `${effectiveFilter.chatId}|${effectiveFilter.query}|${effectiveFilter.fromMs ?? ""}|${effectiveFilter.toMs ?? ""}`
    : "";

  const markReceipts = useCallback(
    (messages: FirestoreMessage[]) => {
      if (!currentUserId || !effectiveFilter) return;

      const deliveredIds: string[] = [];
      const readIds: string[] = [];
      for (const message of messages) {
        if (!message.id || message.senderId === currentUserId) continue;
        if (!message.deliveredTo?.[currentUserId] && !deliveredRef.current.has(message.id)) {
          deliveredRef.current.add(message.id);
          deliveredIds.push(message.id);
        }
        if (!message.readBy?.[currentUserId] && !readRef.current.has(message.id)) {
          readRef.current.add(message.id);
          readIds.push(message.id);
        }
      }

      if (deliveredIds.length > 0) {
        void markMessagesDelivered(effectiveFilter.chatId, deliveredIds);
      }
      if (readIds.length > 0) {
        void markMessagesAsRead(effectiveFilter.chatId, readIds);
      }
    },
    [currentUserId, filterKey]
  );

  const loadPage = useCallback(
    async (initial: boolean) => {
      if (!effectiveFilter || !db || loadingRef.current) return;
      const version = requestVersionRef.current;
      loadingRef.current = true;
      setState((current) => ({
        ...current,
        isInitialLoading: initial,
        isLoadingMore: !initial,
        error: null,
      }));

      try {
        let messages: FirestoreMessage[];
        let hasMore: boolean;
        let nextCursor: DocumentSnapshot | null = cursorRef.current;

        if (effectiveFilter.query) {
          const client = await getSearchClient();
          const searchPage = await searchMessagePage(
            client,
            effectiveFilter,
            pageRef.current
          );
          messages = await hydrateMessageIds(
            effectiveFilter.chatId,
            searchPage.hits.map((hit) => hit.id)
          );
          hasMore = searchPage.hasMore;
        } else {
          if (
            effectiveFilter.fromMs === undefined ||
            effectiveFilter.toMs === undefined
          ) {
            messages = [];
            hasMore = false;
          } else {
            const constraints = [
              where(
                "createdAt",
                ">=",
                Timestamp.fromMillis(effectiveFilter.fromMs)
              ),
              where(
                "createdAt",
                "<=",
                Timestamp.fromMillis(effectiveFilter.toMs)
              ),
              orderBy("createdAt", "desc"),
              ...(cursorRef.current ? [startAfter(cursorRef.current)] : []),
              limit(FILTER_PAGE_SIZE),
            ];
            const snapshot = await getDocs(
              query(
                collection(db, "chats", effectiveFilter.chatId, "messages"),
                ...constraints
              )
            );
            messages = snapshot.docs.map(
              (messageDoc) =>
                ({ id: messageDoc.id, ...messageDoc.data() }) as FirestoreMessage
            );
            nextCursor = snapshot.docs.at(-1) ?? null;
            hasMore = snapshot.docs.length === FILTER_PAGE_SIZE;
          }
        }

        if (version !== requestVersionRef.current) return;
        cursorRef.current = nextCursor;
        pageRef.current += 1;
        markReceipts(messages);
        setState((current) => ({
          messages: mergeChronologically(
            initial ? [] : current.messages,
            messages
          ),
          isInitialLoading: false,
          isLoadingMore: false,
          hasMore,
          error: null,
        }));
      } catch (error) {
        if (version !== requestVersionRef.current) return;
        setState((current) => ({
          ...current,
          isInitialLoading: false,
          isLoadingMore: false,
          error:
            error instanceof Error
              ? error.message
              : "Unable to load filtered messages",
        }));
      } finally {
        if (version === requestVersionRef.current) loadingRef.current = false;
      }
    },
    [filterKey, markReceipts]
  );

  useEffect(() => {
    requestVersionRef.current += 1;
    pageRef.current = 0;
    cursorRef.current = null;
    loadingRef.current = false;
    deliveredRef.current.clear();
    readRef.current.clear();
    setState({
      messages: [],
      isInitialLoading: Boolean(effectiveFilter),
      isLoadingMore: false,
      hasMore: false,
      error: null,
    });
    if (effectiveFilter) void loadPage(true);
  }, [filterKey]);

  const ensureMessage = useCallback(
    async (messageId: string): Promise<boolean> => {
      if (!effectiveFilter || !db) return false;
      if (state.messages.some((message) => message.id === messageId)) return true;

      const version = requestVersionRef.current;
      try {
        const snapshot = await getDoc(
          doc(db, "chats", effectiveFilter.chatId, "messages", messageId)
        );
        if (!snapshot.exists() || version !== requestVersionRef.current) return false;
        const message = {
          id: snapshot.id,
          ...snapshot.data(),
        } as FirestoreMessage;
        markReceipts([message]);
        setState((current) => ({
          ...current,
          messages: mergeChronologically(current.messages, [message]),
        }));
        return true;
      } catch {
        return false;
      }
    },
    [filterKey, state.messages, markReceipts]
  );

  useEffect(() => {
    if (state.messages.length > 0) markReceipts(state.messages);
  }, [markReceipts, state.messages]);

  return {
    ...state,
    isInitialLoading:
      state.isInitialLoading || Boolean(filter && !isQuerySettled),
    loadMore: () => loadPage(false),
    retry: () => loadPage(state.messages.length === 0),
    ensureMessage,
    sessionKey: filterKey,
  };
}
