"use client";

import { useState, useRef, useCallback, useEffect, startTransition } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Plus,
  Send,
  Smile,
  FileText,
  Headphones,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useEnterToSend } from "@/features/chat/hooks/use-enter-to-send";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import EmojiPicker, { Theme, type EmojiClickData } from "emoji-picker-react";
import { useTheme } from "@/components/theme-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { validateStorageUpload } from "@/lib/upload";
import { toast } from "sonner";

export interface PendingMedia {
  file: File;
  preview: string;
  mediaType: "image" | "video" | "audio" | "document";
  caption: string;
}

interface Props {
  media: PendingMedia[];
  onRemove: (index: number) => void;
  onUpdateCaption: (index: number, caption: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onFilesAdded?: (media: PendingMedia[]) => void;
  onSend: () => void;
  isSending: boolean;
}

const THUMBNAIL_SIZE = 60;
const MAX_CAPTION_HEIGHT = 80;

export default function MediaComposer({
  media,
  onRemove,
  onUpdateCaption,
  onReorder,
  onFilesAdded,
  onSend,
  isSending,
}: Props) {
  const { theme } = useTheme();

  // -- Active preview index --
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(activeIndex);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  // -- Local caption buffer: saved to media[activeIndex] on switch --
  const [localCaption, setLocalCaption] = useState("");
  const captionRef = useRef(localCaption);

  useEffect(() => {
    captionRef.current = localCaption;
  }, [localCaption]);

  // -- Emoji picker --
  const [emojiOpen, setEmojiOpen] = useState(false);
  const captionTextareaRef = useRef<HTMLTextAreaElement>(null);

  // -- Auto-resize textarea ref --
  const textareaHeightRef = useRef<HTMLTextAreaElement>(null);

  // -- File input ref for "add more" --
  const fileInputRef = useRef<HTMLInputElement>(null);

  // -- Drag-and-drop state --
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // --- Save caption helper: flushes the local buffer to the media array ---
  const flushCaption = useCallback(() => {
    const idx = activeIndexRef.current;
    if (idx >= 0 && idx < media.length) {
      onUpdateCaption(idx, captionRef.current);
    }
  }, [media.length, onUpdateCaption]);

  // --- Sync local caption when activeIndex or media[activeIndex].caption changes ---
  useEffect(() => {
    const item = media[activeIndex];
    startTransition(() => {
      setLocalCaption(item?.caption ?? "");
    });
  }, [activeIndex, media]);

  // --- Auto-resize textarea (grows upward from bottom) ---
  const autoResize = useCallback(() => {
    const ta = textareaHeightRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const newHeight = Math.min(ta.scrollHeight, MAX_CAPTION_HEIGHT);
    ta.style.height = `${newHeight}px`;
    ta.style.overflowY = newHeight >= MAX_CAPTION_HEIGHT ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    autoResize();
  }, [localCaption, autoResize]);

  // --- Switching media: flush current caption, then switch ---
  const goTo = useCallback(
    (idx: number) => {
      if (idx === activeIndex || idx < 0 || idx >= media.length) return;
      flushCaption();
      setActiveIndex(idx);
    },
    [activeIndex, media.length, flushCaption]
  );

  const goPrev = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo]);
  const goNext = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo]);

  // --- Keyboard navigation ---
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "Escape") {
        // Handled by close button alert dialog
      }
    },
    [goPrev, goNext]
  );

  // --- Send handler ---
  const handleSend = useCallback(() => {
    flushCaption();
    onSend();
  }, [flushCaption, onSend]);
  const handleEnterSend = useEnterToSend(handleSend);

  // --- Caption change ---
  const handleCaptionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setLocalCaption(e.target.value);
    },
    []
  );

  // --- Emoji click handler ---
  const handleEmojiClick = useCallback(
    (emojiData: EmojiClickData) => {
      const ta = captionTextareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next =
        localCaption.slice(0, start) + emojiData.emoji + localCaption.slice(end);
      setLocalCaption(next);
      requestAnimationFrame(() => {
        const pos = start + emojiData.emoji.length;
        ta.setSelectionRange(pos, pos);
        autoResize();
      });
    },
    [localCaption, autoResize]
  );

  // --- Remove handler ---
  const handleRemove = useCallback(
    (idx: number) => {
      URL.revokeObjectURL(media[idx].preview);
      onRemove(idx);
      if (idx < activeIndex) {
        setActiveIndex((prev) => prev - 1);
      } else if (idx === activeIndex) {
        // If removing the last item, adjust
        if (activeIndex >= media.length - 1) {
          setActiveIndex(Math.max(0, media.length - 2));
        }
      }
    },
    [activeIndex, media, onRemove]
  );

  // --- Add more files ---
  const handleAddMore = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || !onFilesAdded) return;

      const result: PendingMedia[] = [];
      Array.from(e.target.files).forEach((file) => {
        const isVideo = file.type.startsWith("video/");
        const isImage = file.type.startsWith("image/") || isVideo;
        const isAudio = file.type.startsWith("audio/");

        // Detect actual type: video/* → "video", not "image"
        const actualType = isVideo ? "video" : isImage ? "image" : isAudio ? "audio" : "document";
        const validationError = validateStorageUpload(actualType, file);
        if (validationError) {
          toast.error(`${file.name}: ${validationError}`);
          return;
        }
        result.push({
          file,
          preview: URL.createObjectURL(file),
          mediaType: actualType,
          caption: "",
        });
      });

      if (result.length > 0) {
        flushCaption();
        onFilesAdded(result);
      }
      e.target.value = "";
    },
    [onFilesAdded]
  );

  // --- Thumbnail drag-and-drop ---
  const handleDragStart = useCallback(
    (idx: number) => {
      setDragIndex(idx);
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, idx: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverIndex(idx);
    },
    []
  );

  const handleDrop = useCallback(
    (toIndex: number) => {
      if (dragIndex !== null && dragIndex !== toIndex) {
        // Flush current caption before reorder, then adjust activeIndex
        flushCaption();
        onReorder(dragIndex, toIndex);
        if (activeIndex === dragIndex) {
          setActiveIndex(toIndex);
        } else if (activeIndex === toIndex) {
          setActiveIndex(dragIndex);
        }
      }
      setDragIndex(null);
      setDragOverIndex(null);
    },
    [dragIndex, onReorder, activeIndex, flushCaption]
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  const activeItem = media[activeIndex];
  const isImage = activeItem?.mediaType === "image";
  const isVideo = activeItem?.mediaType === "video";
  const isDocument = activeItem?.mediaType === "document";
  const isAudio = activeItem?.mediaType === "audio";

  if (media.length === 0) return null;

  const overlay = (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black"
      onKeyDown={handleKeyDown}
    >
      {/* Hidden file input for add more */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
        multiple
        className="hidden"
      />

      {/* ---- Top bar ---- */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10"
            >
              <X className="h-6 w-6" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard media?</AlertDialogTitle>
              <AlertDialogDescription>
                Your selected media and captions will be deleted. This cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  // Flush caption and remove all media
                  flushCaption();
                  media.forEach((m) => URL.revokeObjectURL(m.preview));
                  // Remove all by calling onRemove for each, from last to first
                  for (let i = media.length - 1; i >= 0; i--) {
                    onRemove(i);
                  }
                }}
              >
                Discard
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <span className="text-sm text-white/60 tabular-nums">
          {activeIndex + 1} / {media.length}
        </span>
      </div>

      {/* ---- Center: Large media preview ---- */}
      <div className="flex-1 flex items-center justify-center px-4 py-2 min-h-0">
        <div className="relative w-[min(460px,90vw)] h-[min(460px,55vh)] flex items-center justify-center overflow-hidden rounded-xl bg-black/40">
          {activeItem && isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={activeItem.preview}
              alt=""
              className="max-w-full max-h-full object-contain"
            />
          )}
          {activeItem && isVideo && (
            <video
              src={activeItem.preview}
              className="max-w-full max-h-full object-contain"
              controls
              muted
              playsInline
            />
          )}
          {activeItem && isAudio && (
            <div className="flex flex-col items-center gap-3 text-white/60">
              <Headphones className="h-16 w-16" />
              <span className="text-sm truncate max-w-[200px]">
                {activeItem.file.name}
              </span>
            </div>
          )}
          {activeItem && isDocument && (
            <div className="flex flex-col items-center gap-3 text-white/60">
              <FileText className="h-16 w-16" />
              <span className="text-sm truncate max-w-[200px]">
                {activeItem.file.name}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ---- Bottom section ---- */}
      <div className="shrink-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent pt-6 pb-safe-or-4">
        {/* Caption + emoji + send */}
        <div className="flex items-center justify-center gap-2 px-4 pb-3 relative z-10">
          {/* Emoji picker */}
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-white/70 hover:text-white hover:bg-white/10 shrink-0 self-center"
              >
                <Smile className="h-6 w-6" />
              </Button>
            </PopoverTrigger>
            {createPortal(
              <PopoverContent
                align="start"
                side="top"
                className="w-auto p-0 border-0"
              >
                <EmojiPicker
                  theme={theme === "dark" ? Theme.DARK : Theme.LIGHT}
                  onEmojiClick={handleEmojiClick}
                  width={350}
                  height={400}
                />
              </PopoverContent>,
              document.body
            )}
          </Popover>

          {/* Caption textarea */}
          <div className="w-[50%] flex flex-col-reverse">
            <Textarea
              ref={(el) => {
                textareaHeightRef.current = el;
                captionTextareaRef.current = el;
              }}
              value={localCaption}
              onChange={handleCaptionChange}
              onKeyDown={handleEnterSend}
              placeholder="Add a caption..."
              rows={1}
              className="w-full resize-none overflow-y-auto min-h-[40px] max-h-[80px] border-white/20 bg-white/10 text-white placeholder:text-white/40 focus-visible:border-white/40 focus-visible:ring-white/20 text-sm"
            />
          </div>

          {/* Send button */}
          <Button
            type="button"
            size="icon"
            // disabled={isSending}
            onClick={handleSend}
            className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>

        {/* Thumbnail strip */}
        <div className="px-4 mt-2 flex justify-center">
          <ScrollArea className="w-full">
          <div className="flex items-center gap-2 pb-1">
            {media.map((item, idx) => (
              <div
                key={`${item.preview}-${idx}`}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={() => handleDrop(idx)}
                onDragEnd={handleDragEnd}
                onClick={() => goTo(idx)}
                className={cn(
                  "relative shrink-0 rounded-lg overflow-hidden border-2 transition-all cursor-pointer",
                  idx === activeIndex
                    ? "border-white border-2 ring-1 ring-white/40"
                    : "border-transparent opacity-60 hover:opacity-80",
                  dragIndex === idx && "opacity-40 scale-90",
                  dragOverIndex === idx &&
                    dragIndex !== idx &&
                    "border-primary"
                )}
                style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
              >
                {item.mediaType === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.preview}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : item.mediaType === "video" ? (
                  <video
                    src={item.preview}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center bg-white/10">
                    {item.mediaType === "audio" ? (
                      <Headphones className="h-5 w-5 text-white/70" />
                    ) : (
                      <FileText className="h-5 w-5 text-white/70" />
                    )}
                  </div>
                )}

                {/* Draggable grip indicator */}
                <div className="absolute top-0.5 left-0.5 text-white/50">
                  <GripVertical className="h-3 w-3" />
                </div>

                {/* Remove button on thumbnail */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(idx);
                  }}
                  className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full p-0.5 hover:bg-black/80"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}

            {/* Plus button */}
            {onFilesAdded && (
              <button
                type="button"
                onClick={handleAddMore}
                className="shrink-0 rounded-lg border border-dashed border-white/30 hover:border-white/60 text-white/50 hover:text-white/70 transition-colors flex items-center justify-center"
                style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
              >
                <Plus className="h-5 w-5" />
              </button>
            )}
          </div>
          <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
