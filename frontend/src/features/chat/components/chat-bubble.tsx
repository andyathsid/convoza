"use client";

import { memo, useState, useCallback, useEffect, useMemo } from "react";

import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/features/chat/lib/helper";
import { useProfiles } from "@/stores/use-profiles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import MediaPreview from "./media-preview";
import MediaGroup from "./media-group";
import { FileText, Download, Check, CheckCheck, Loader2, AlertCircle, RotateCcw, Film, ChevronDown, Reply, Copy } from "lucide-react";
import { toast } from "sonner";
import type { FirestoreMessage } from "@/features/chat/types/chat";

// ─── TruncatedText ──────────────────────────────────────────────────

const TRUNCATE_THRESHOLD = 300;

function TruncatedText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = text.length > TRUNCATE_THRESHOLD;

  if (!needsTruncation) {
    return <p className="whitespace-pre-wrap">{text}</p>;
  }

  return (
    <div className="whitespace-pre-wrap">
      {expanded ? (
        <span>{text}</span>
      ) : (
        <span className="line-clamp-4">{text}</span>
      )}
      {" "}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((prev) => !prev);
        }}
        className="text-blue-500 hover:underline text-xs font-medium cursor-pointer"
      >
        {expanded ? "Read less" : "Read more"}
      </button>
    </div>
  );
}

// ─── MediaContainer ──────────────────────────────────────────────────

type MediaAspect = "landscape" | "portrait";

const MediaContainer = ({ aspect, children }: { aspect: MediaAspect; children: React.ReactNode }) => (
  <div className={cn(
    "relative",
    aspect === "portrait" ? "w-[280px] aspect-[3/4]" : "w-[340px] aspect-[4/3]"
  )}>
    {children}
  </div>
);

function getAspectFromDimensions(width?: number, height?: number): MediaAspect {
  if (width && height && height > width *1.1) return "portrait";
  return "landscape";
}

const useMediaAspect = (src: string, mediaWidth?: number, mediaHeight?: number): { aspect: MediaAspect; onImageLoad: (img: HTMLImageElement) => void } => {
  const [aspect, setAspect] = useState<MediaAspect>(
    getAspectFromDimensions(mediaWidth, mediaHeight)
  );

  // Only do client-side detection if dimensions not provided (legacy messages)
  useEffect(() => {
    if (!src) return;
    if (mediaWidth && mediaHeight) return; // Skip, we already know
    const img = new Image();
    img.onload = () => {
      if (img.naturalHeight > img.naturalWidth) {
        setAspect("portrait");
      }
    };
    img.src = src;
  }, [src, mediaWidth, mediaHeight]);

  const onImageLoad = useCallback((img: HTMLImageElement) => {
    if (mediaWidth && mediaHeight) return; // Skip
    if (img.naturalHeight > img.naturalWidth) {
      setAspect("portrait");
    }
  }, [mediaWidth, mediaHeight]);

  return { aspect, onImageLoad };
};

// ─── Sub-components ──────────────────────────────────────────────────

export const StatusIndicator = ({ message, isCurrentUser, onRetry }: { message: FirestoreMessage; isCurrentUser?: boolean; onRetry?: (pendingId: string) => void }) => {
  if (message.pendingId && message.status) {
    const isUploading = message.status === "uploading";
    const isSending = message.status === "sending";
    const isSent = message.status === "sent";
    const isFailed = message.status === "failed";

    return (
      <div className={cn("flex items-center gap-1", isFailed && "cursor-pointer group/status")} onClick={() => isFailed && message.pendingId && onRetry?.(message.pendingId)}>
        {isUploading && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
        {isSending && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
        {isSent && (
          <Check className="h-3 w-3 text-muted-foreground" />
        )}
        {isFailed && (
          <>
            <AlertCircle className="h-3 w-3 text-destructive" />
            <span className="text-[10px] text-destructive flex items-center gap-1">
              Failed
              <span className="hidden group-hover/status:inline-flex items-center gap-0.5 underline">
                <RotateCcw className="h-2.5 w-2.5" />
                Tap to retry
              </span>
            </span>
          </>
        )}
      </div>
    );
  }

  if (!isCurrentUser) return null;

  const hasDelivered = !!message.deliveredTo && Object.keys(message.deliveredTo).length > 0;
  const hasRead = !!message.readBy && Object.keys(message.readBy).length > 0;

  if (hasRead) {
    return <CheckCheck className="h-3 w-3 text-blue-500" />;
  }
  if (hasDelivered) {
    return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
  }

  return <Check className="h-3 w-3 text-muted-foreground" />;
};

const UploadProgressOverlay = ({ progress }: { progress?: number }) => {
  if (progress === undefined || progress >= 100) return null;

  return (
    <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg z-10">
      <div className="relative w-10 h-10">
        <svg className="w-10 h-10 -rotate-90" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="16" fill="none" stroke="white" strokeWidth="3" opacity="0.3" />
          <circle
            cx="20" cy="20" r="16"
            fill="none" stroke="white" strokeWidth="3"
            strokeDasharray={`${progress * 1.005} 100.5`}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white">
          {Math.round(progress)}%
        </span>
      </div>
    </div>
  );
};

// ─── Single Media Renderer ───────────────────────────────────────────

const SingleMedia = ({ message, onOpenMedia }: { message: FirestoreMessage; onOpenMedia?: (messageId: string, mediaIndex: number) => void }) => {
  const mediaUrl = message.mediaUrl;
  const mediaType = message.mediaType;
  const thumbnailUrl = message.thumbnailUrl;
  const detectSrc = thumbnailUrl || mediaUrl || "";
  const { aspect, onImageLoad } = useMediaAspect(detectSrc, message.mediaWidth, message.mediaHeight);

  if (!mediaUrl || !mediaType) return null;

  if (mediaType === "image") {
    return (
      <MediaContainer aspect={aspect}>
        <MediaPreview
          src={thumbnailUrl || mediaUrl}
          aspect={aspect}
          onMediaLoad={onImageLoad}
          onClick={onOpenMedia ? () => onOpenMedia(message.id || message.pendingId || "", 0) : undefined}
          overlay={<UploadProgressOverlay progress={message.uploadProgress} />}
        />
      </MediaContainer>
    );
  }

  if (mediaType === "video") {
    return (
      <MediaContainer aspect={aspect}>
        <MediaPreview
          src={thumbnailUrl || mediaUrl}
          aspect={aspect}
          onMediaLoad={onImageLoad}
          onClick={onOpenMedia ? () => onOpenMedia(message.id || message.pendingId || "", 0) : undefined}
          overlay={
            <>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/50 rounded-full p-2">
                  <Film className="h-5 w-5 text-white" />
                </div>
              </div>
              <UploadProgressOverlay progress={message.uploadProgress} />
            </>
          }
        />
      </MediaContainer>
    );
  }

  if (mediaType === "audio") {
    return (
      <div className="relative">
        <audio controls src={mediaUrl} className="w-[400px] h-10" />
        <UploadProgressOverlay progress={message.uploadProgress} />
      </div>
    );
  }

  if (mediaType === "document") {
    return (
      <div className="w-[340px]">
        <a
          href={mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 p-2 bg-background/50 rounded-lg hover:bg-background/70 relative"
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="text-xs truncate min-w-0 flex-1">{message.documentName || "Document"}</span>
          <Download className="h-3 w-3 ml-auto shrink-0" />
          <UploadProgressOverlay progress={message.uploadProgress} />
        </a>
      </div>
    );
  }

  return null;
};

// ─── ChatBubble ──────────────────────────────────────────────────────

interface ChatBubbleProps {
  message: FirestoreMessage;
  isCurrentUser: boolean;
  isPending: boolean;
  isFailed: boolean;
  onRetry?: (pendingId: string) => void;
  onOpenMedia?: (messageId: string, mediaIndex: number) => void;
  onJumpToMessage?: (messageId: string) => void;
  isHighlighted?: boolean;
  mediaGroup?: FirestoreMessage[] | null;
  onOpenGroupLightbox?: (messages: FirestoreMessage[], index: number) => void;
  onReply?: (message: FirestoreMessage) => void;
  isReadOnly?: boolean;
}

const ChatBubble = memo(({ message, isCurrentUser, isPending, isFailed, onRetry, onOpenMedia, onJumpToMessage, isHighlighted, mediaGroup, onOpenGroupLightbox, onReply, isReadOnly = false }: ChatBubbleProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const hasMedia = !!message.mediaUrl;
  const profiles = useProfiles((s) => s.profiles);
  const copyText = message.content?.trim() ?? "";
  const canCopy = copyText.length > 0;

  const handleCopy = useCallback(async (event: Event) => {
    event.stopPropagation();
    if (!canCopy) return;

    try {
      await navigator.clipboard.writeText(copyText);
      toast.success("Copied");
    } catch {
      toast.error("Unable to copy");
    }
  }, [canCopy, copyText]);

  const handleReply = useCallback((event: Event) => {
    event.stopPropagation();
    onReply?.(message);
  }, [message, onReply]);

  const replySenderName = useMemo(() => {
    if (!message.replyTo) return "";
    const replySenderId = message.replyTo.senderId;
    const replyProfile = replySenderId ? profiles.get(replySenderId) : undefined;
    return replyProfile?.username || message.replyTo.senderName || "Unknown";
  }, [message.replyTo, profiles]);

  const messageClass = cn(
    "w-fit px-2.5 py-1.5 text-sm break-words shadow-sm",
    isCurrentUser
      ? "bg-accent dark:bg-primary/40 rounded-tr-xl rounded-l-xl"
      : "bg-[#F5F5F5] dark:bg-accent rounded-bl-xl rounded-r-xl",
    isPending && "opacity-90",
    isFailed && "border border-destructive/30",
    isHighlighted && "jump-highlight"
  );

  const replyPreviewText = message.replyTo
    ? message.replyTo.content
      ? message.replyTo.content
      : message.replyTo.mediaUrl
        ? (message.replyTo.mediaType === "video" ? "Video" : message.replyTo.mediaType === "audio" ? "Audio" : message.replyTo.mediaType === "document" ? "Document" : "Photo")
        : "Message"
    : "Message";

  return (
    <div className={cn("relative group/bubble", messageClass)}>
      {!isReadOnly && (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Open message actions"
              onClick={(event) => event.stopPropagation()}
              className={cn(
                "absolute right-0.5 top-0.5 z-20 flex size-5 items-center justify-center rounded-full bg-transparent text-muted-foreground opacity-0 transition-opacity hover:bg-transparent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none data-[state=open]:opacity-100 group-hover/bubble:opacity-100"
              )}
            >
              <ChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="bottom"
            sideOffset={2}
            className="z-[99999] w-32 min-w-32 rounded-md border-border bg-popover p-1 text-popover-foreground shadow-md"
            onClick={(event) => event.stopPropagation()}
          >
            <DropdownMenuItem
              onSelect={handleReply}
              className="cursor-pointer gap-2 rounded-sm px-2 py-1.5 text-xs font-medium focus:bg-accent focus:text-accent-foreground"
            >
              <Reply className={cn("size-3.5", isCurrentUser && "scale-x-[-1]")} />
              Reply
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canCopy}
              onSelect={handleCopy}
              className="cursor-pointer gap-2 rounded-sm px-2 py-1.5 text-xs font-medium focus:bg-accent focus:text-accent-foreground data-disabled:cursor-not-allowed data-disabled:text-muted-foreground"
            >
              <Copy className="size-3.5" />
              Copy
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {message.replyToId && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => onJumpToMessage?.(message.replyToId!)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onJumpToMessage?.(message.replyToId!);
            }
          }}
          className={cn(
            "mb-1 p-1.5 text-xs rounded-md border-l-4 shadow-md cursor-pointer hover:opacity-80 transition-opacity",
            isCurrentUser ? "bg-primary/20 border-l-primary" : "bg-gray-200 dark:bg-secondary border-l-[#CC4A31]"
          )}
        >
          <p className="font-medium text-primary-emphasis mb-0.5">
            {replySenderName}
          </p>
          <p className="font-normal text-primary-muted-foreground truncate">
            {replyPreviewText}
          </p>
        </div>
      )}

      {mediaGroup ? (
        <>
          <MediaGroup
            messages={mediaGroup}
            onOpenLightbox={onOpenGroupLightbox || (() => {})}
          />

          {/* Caption from first message: only for 2-3 item groups (WhatsApp rule) */}
          {mediaGroup[0]?.content && mediaGroup.length >= 2 && mediaGroup.length <= 3 && (
            <div className="text-sm mt-0.5">
              <TruncatedText text={mediaGroup[0].content} />
            </div>
          )}

          {/* Timestamp from first message */}
          <div className="flex justify-end items-center gap-1">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {formatMessageTime(message.createdAt)}
            </span>
            <StatusIndicator message={message} isCurrentUser={isCurrentUser} onRetry={onRetry} />
          </div>
        </>
      ) : hasMedia ? (
        <>
          <SingleMedia message={message} onOpenMedia={onOpenMedia} />

          {/* Caption text */}
          {message.content && (
            <div className="text-sm mt-0.5">
              <TruncatedText text={message.content} />
            </div>
          )}

          {/* Timestamp */}
          <div className="flex justify-end items-center gap-1">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {formatMessageTime(message.createdAt)}
            </span>
            <StatusIndicator message={message} isCurrentUser={isCurrentUser} onRetry={onRetry} />
          </div>
        </>
      ) : message.content ? (
        /* Pure text message: 2x2 grid with timestamp */
        <div className="grid grid-cols-[1fr_auto] grid-rows-[auto_auto] w-full">
          <div className="col-start-1 row-start-1 min-w-0">
            <TruncatedText text={message.content} />
          </div>
          <div className="col-start-2 row-start-2 flex justify-end items-center gap-1">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
              {formatMessageTime(message.createdAt)}
            </span>
            <StatusIndicator message={message} isCurrentUser={isCurrentUser} onRetry={onRetry} />
          </div>
        </div>
      ) : null}
    </div>
  );
});

ChatBubble.displayName = "ChatBubble";

export default ChatBubble;
