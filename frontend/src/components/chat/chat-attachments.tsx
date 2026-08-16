"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { format } from "date-fns";
import {
  ArrowLeft,
  ChevronRight,
  Download,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  X,
} from "lucide-react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/lib/helper";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MessageType } from "@/types";
import MediaLightbox from "./media-lightbox";

const PAGE_SIZE = 30;

type AttachmentTab = "media" | "docs" | "audio";

interface TabPage {
  items: MessageType[];
  cursor: QueryDocumentSnapshot<DocumentData> | null;
  hasMore: boolean;
  loading: boolean;
  initialized: boolean;
  error: string | null;
}

type TabPages = Record<AttachmentTab, TabPage>;

function emptyPage(): TabPage {
  return {
    items: [],
    cursor: null,
    hasMore: true,
    loading: false,
    initialized: false,
    error: null,
  };
}

function emptyPages(): TabPages {
  return {
    media: emptyPage(),
    docs: emptyPage(),
    audio: emptyPage(),
  };
}

function attachmentDate(value: MessageType["createdAt"]): Date | null {
  if (typeof value?.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthLabel(message: MessageType): string {
  const date = attachmentDate(message.createdAt);
  return date ? format(date, "MMMM yyyy") : "Unknown date";
}

function groupByMonth(items: MessageType[]) {
  const groups = new Map<string, MessageType[]>();
  for (const item of items) {
    const label = monthLabel(item);
    const group = groups.get(label);
    if (group) group.push(item);
    else groups.set(label, [item]);
  }
  return Array.from(groups, ([label, messages]) => ({ label, messages }));
}

interface PreviewProps {
  messages: MessageType[];
  onOpenGallery: () => void;
  className?: string;
}

export function ChatAttachmentsPreview({ messages, onOpenGallery, className }: PreviewProps) {
  const [lightbox, setLightbox] = useState<{ items: MessageType[]; index: number } | null>(null);

  const attachments = useMemo(
    () => messages.filter((message) => message.mediaUrl && message.mediaType),
    [messages]
  );
  const mediaItems = useMemo(
    () => attachments.filter(
      (message) => message.mediaType === "image" || message.mediaType === "video"
    ),
    [attachments]
  );

  return (
    <>
      <div className={cn("px-4 py-5 space-y-3", className)}>
        <button
          type="button"
          onClick={onOpenGallery}
          className="w-full flex items-center justify-between rounded-md text-left group cursor-pointer"
          aria-label="Open media, documents, and audio"
        >
          <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase group-hover:text-foreground transition-colors">
            Media, docs and audio
          </span>
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            {attachments.length}
            <ChevronRight className="h-4 w-4" />
          </span>
        </button>

        {mediaItems.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 mt-2">
            {mediaItems.slice(0, 3).map((item, index) => (
              <button
                key={`${item.id || item.mediaUrl}-${index}`}
                type="button"
                onClick={() => setLightbox({ items: mediaItems, index })}
                className="relative aspect-square rounded-md overflow-hidden bg-muted border border-border/50 group cursor-pointer"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.thumbnailUrl || item.mediaUrl}
                  alt={item.documentName || "Shared media"}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {item.mediaType === "video" && (
                  <span className="absolute top-1.5 left-1.5 rounded-full bg-black/60 p-1">
                    <Film className="h-3.5 w-3.5 text-white" />
                  </span>
                )}
                {index === 2 && mediaItems.length > 3 && (
                  <span className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-lg font-semibold">
                    +{mediaItems.length - 3}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenGallery}
            className="w-full flex items-center gap-3 text-sm text-muted-foreground py-1 text-left cursor-pointer hover:text-foreground"
          >
            <ImageIcon className="h-4 w-4 shrink-0" />
            <span>No media shared yet</span>
          </button>
        )}
      </div>

      {lightbox && createPortal(
        <MediaLightbox
          messages={lightbox.items}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />,
        document.body
      )}
    </>
  );
}

interface PanelProps {
  chatId: string;
  currentUserId: string | null;
  onBack: () => void;
  onClose: () => void;
}

const tabs: Array<{ id: AttachmentTab; label: string }> = [
  { id: "media", label: "Media" },
  { id: "docs", label: "Docs" },
  { id: "audio", label: "Audio" },
];

export function ChatAttachmentsPanel({ chatId, currentUserId, onBack, onClose }: PanelProps) {
  const [activeTab, setActiveTab] = useState<AttachmentTab>("media");
  const [pages, setPages] = useState<TabPages>(emptyPages);
  const [lightbox, setLightbox] = useState<{ items: MessageType[]; index: number } | null>(null);
  const pagesRef = useRef(pages);
  const requestGeneration = useRef(0);
  const loadingTabs = useRef(new Set<AttachmentTab>());
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => () => {
    requestGeneration.current += 1;
    loadingTabs.current.clear();
  }, []);

  const loadMore = useCallback(async (tab: AttachmentTab) => {
    const currentPage = pagesRef.current[tab];
    if (!db || currentPage.loading || !currentPage.hasMore || loadingTabs.current.has(tab)) return;

    loadingTabs.current.add(tab);
    const generation = requestGeneration.current;
    setPages((current) => ({
      ...current,
      [tab]: { ...current[tab], loading: true, error: null },
    }));

    try {
      const mediaTypeFilter = tab === "media"
        ? where("mediaType", "in", ["image", "video"])
        : where("mediaType", "==", tab === "docs" ? "document" : "audio");
      const constraints = [
        mediaTypeFilter,
        orderBy("createdAt", "desc"),
        ...(currentPage.cursor ? [startAfter(currentPage.cursor)] : []),
        limit(PAGE_SIZE),
      ];
      const snapshot = await getDocs(query(
        collection(db, "chats", chatId, "messages"),
        ...constraints
      ));

      if (generation !== requestGeneration.current) return;

      const nextItems = snapshot.docs
        .map((messageDoc) => ({ id: messageDoc.id, ...messageDoc.data() } as MessageType))
        .filter((message) => Boolean(message.mediaUrl));
      const nextCursor = snapshot.docs.at(-1) ?? null;

      setPages((current) => {
        const knownIds = new Set(current[tab].items.map((item) => item.id));
        const uniqueItems = nextItems.filter((item) => !item.id || !knownIds.has(item.id));
        return {
          ...current,
          [tab]: {
            items: [...current[tab].items, ...uniqueItems],
            cursor: nextCursor,
            hasMore: snapshot.size === PAGE_SIZE,
            loading: false,
            initialized: true,
            error: null,
          },
        };
      });
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      console.error("Failed to load chat attachments:", error);
      setPages((current) => ({
        ...current,
        [tab]: {
          ...current[tab],
          loading: false,
          initialized: true,
          error: "Could not load attachments. Verify the Firestore composite index is deployed.",
        },
      }));
    } finally {
      loadingTabs.current.delete(tab);
    }
  }, [chatId]);

  const activePage = pages[activeTab];

  useEffect(() => {
    if (!activePage.initialized && !activePage.loading) void loadMore(activeTab);
  }, [activePage.initialized, activePage.loading, activeTab, loadMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !activePage.initialized || !activePage.hasMore) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) void loadMore(activeTab);
    }, { rootMargin: "240px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activePage.hasMore, activePage.initialized, activeTab, loadMore]);

  const groups = useMemo(() => groupByMonth(activePage.items), [activePage.items]);

  return (
    <div className="flex flex-col h-full bg-card select-none" role="complementary" aria-label="Chat attachments">
      <div className="h-14 px-3 flex items-center justify-between border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} aria-label="Back to chat info">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h3 className="font-semibold text-base">Media, docs and audio</h3>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="Close attachments">
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="grid grid-cols-3 border-b border-border shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "relative h-12 text-sm font-medium transition-colors cursor-pointer",
              activeTab === tab.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {activeTab === tab.id && <span className="absolute inset-x-4 bottom-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {activePage.error ? (
          <div className="flex flex-col items-center justify-center min-h-64 px-8 text-center gap-3">
            <p className="text-sm text-muted-foreground">{activePage.error}</p>
            <Button variant="outline" size="sm" onClick={() => {
              setPages((current) => ({
                ...current,
                [activeTab]: { ...current[activeTab], initialized: false, error: null, hasMore: true },
              }));
            }}>
              Retry
            </Button>
          </div>
        ) : activePage.initialized && activePage.items.length === 0 ? (
          <EmptyTab tab={activeTab} />
        ) : (
          <div className="px-3 py-4 space-y-6">
            {groups.map((group) => (
              <section key={group.label} className="space-y-2">
                <h4 className="px-1 text-xs font-semibold uppercase text-muted-foreground">{group.label}</h4>
                {activeTab === "media" ? (
                  <MediaGrid
                    items={group.messages}
                    allItems={activePage.items}
                    onOpen={(index) => setLightbox({ items: activePage.items, index })}
                  />
                ) : activeTab === "docs" ? (
                  <DocumentList items={group.messages} currentUserId={currentUserId} />
                ) : (
                  <AudioList items={group.messages} currentUserId={currentUserId} />
                )}
              </section>
            ))}
            <div ref={sentinelRef} className="h-1" />
            {activePage.loading && (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {lightbox && createPortal(
        <MediaLightbox messages={lightbox.items} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />,
        document.body
      )}
    </div>
  );
}

function MediaGrid({
  items,
  allItems,
  onOpen,
}: {
  items: MessageType[];
  allItems: MessageType[];
  onOpen: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {items.map((item, localIndex) => {
        const index = item.id
          ? allItems.findIndex((candidate) => candidate.id === item.id)
          : allItems.indexOf(item);
        return (
          <button
            key={`${item.id || item.mediaUrl}-${localIndex}`}
            type="button"
            onClick={() => onOpen(index)}
            className="relative aspect-square overflow-hidden rounded-sm bg-muted cursor-pointer group"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.thumbnailUrl || item.mediaUrl}
              alt={item.content || "Shared media"}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            />
            {item.mediaType === "video" && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/10">
                <span className="rounded-full bg-black/55 p-2">
                  <Film className="h-4 w-4 text-white" />
                </span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function senderLabel(item: MessageType, currentUserId: string | null): string {
  return item.senderId === currentUserId ? "You" : item.senderName || "Unknown";
}

function DocumentList({ items, currentUserId }: { items: MessageType[]; currentUserId: string | null }) {
  return (
    <div className="divide-y divide-border/60">
      {items.map((item, index) => (
        <a
          key={`${item.id || item.mediaUrl}-${index}`}
          href={item.mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 py-3 px-1 hover:bg-accent/40 rounded-md transition-colors"
        >
          <span className="h-10 w-10 rounded-md bg-accent flex items-center justify-center shrink-0">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium truncate">{item.documentName || "Document"}</span>
            <span className="block text-xs text-muted-foreground truncate">
              {senderLabel(item, currentUserId)} · {formatMessageTime(item.createdAt)}
            </span>
          </span>
          <Download className="h-4 w-4 text-muted-foreground shrink-0" />
        </a>
      ))}
    </div>
  );
}

function AudioList({ items, currentUserId }: { items: MessageType[]; currentUserId: string | null }) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={`${item.id || item.mediaUrl}-${index}`} className="rounded-lg border border-border/60 bg-accent/20 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Music className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Audio message</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {senderLabel(item, currentUserId)} · {formatMessageTime(item.createdAt)}
            </span>
          </div>
          <audio controls preload="none" src={item.mediaUrl} className="w-full h-10" />
        </div>
      ))}
    </div>
  );
}

function EmptyTab({ tab }: { tab: AttachmentTab }) {
  const config = tab === "media"
    ? { icon: ImageIcon, label: "No media shared yet" }
    : tab === "docs"
      ? { icon: FileText, label: "No documents shared yet" }
      : { icon: Music, label: "No audio shared yet" };
  const Icon = config.icon;

  return (
    <div className="flex flex-col items-center justify-center min-h-64 gap-3 text-muted-foreground">
      <Icon className="h-8 w-8" />
      <p className="text-sm">{config.label}</p>
    </div>
  );
}
