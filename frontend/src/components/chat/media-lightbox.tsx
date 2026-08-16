"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { X, ChevronLeft, ChevronRight, Film, Loader2 } from "lucide-react";
import type { MessageType } from "@/types";

interface MediaLightboxProps {
  messages: MessageType[];
  initialIndex: number;
  onClose: () => void;
}

interface MediaSelectorProps {
  messages: MessageType[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

function MediaSelector({ messages, currentIndex, onSelect }: MediaSelectorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const selected = itemRefs.current[currentIndex];
    if (selected && scrollRef.current) {
      selected.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  }, [currentIndex]);

  return (
    <div className="h-full flex items-center px-4">
      <ScrollArea className="w-full h-full">
        <div
          ref={scrollRef}
          className="flex gap-2 py-3 items-center justify-start h-full"
        >
          {messages.map((msg, idx) => {
            const thumbSrc = msg.thumbnailUrl || msg.mediaUrl;
            const isVid = msg.mediaType === "video";
            const isActive = idx === currentIndex;

            return (
              <button
                key={`${msg.id || msg.pendingId || idx}-${idx}`}
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                onClick={() => onSelect(idx)}
                className={cn(
                  "flex-shrink-0 w-14 h-14 rounded overflow-hidden border-2 transition-all",
                  isActive
                    ? "border-white scale-105"
                    : "border-transparent opacity-60 hover:opacity-80"
                )}
              >
                {isVid ? (
                  <div className="relative w-full h-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbSrc}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Film className="h-3 w-3 text-white drop-shadow" />
                    </div>
                  </div>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={thumbSrc}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                )}
              </button>
            );
          })}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}

export default function MediaLightbox({ messages, initialIndex, onClose }: MediaLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [imageLoaded, setImageLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleNavigate = useCallback((newIndex: number) => {
    if (newIndex < 0 || newIndex >= messages.length) return;
    setCurrentIndex(newIndex);
    setImageLoaded(false);
  }, [messages.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") handleNavigate(currentIndex - 1);
      if (e.key === "ArrowRight") handleNavigate(currentIndex + 1);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentIndex, handleNavigate, onClose]);

  const currentItem = messages[currentIndex];
  if (!currentItem) return null;

  const mediaUrl = currentItem.mediaUrl;
  const mediaType = currentItem.mediaType;
  const caption = currentItem.content;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[9999] bg-black/90 flex flex-col h-full"
      onClick={(e) => {
        if (e.target === containerRef.current) onClose();
      }}
    >
      {/* Header */}
      <div className="flex-shrink-0 h-14 flex items-center justify-between px-4 bg-transparent">
        <div className="text-white/80 text-sm">
          {currentIndex + 1} / {messages.length}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-white/80 hover:text-white"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center relative min-h-0 overflow-hidden">
        {messages.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => handleNavigate(currentIndex - 1)}
              disabled={currentIndex === 0}
              className={cn(
                "absolute left-4 top-1/2 -translate-y-1/2 bg-white/10 text-white rounded-full p-2 hover:bg-white/20 transition-colors z-10",
                currentIndex === 0 && "opacity-30 cursor-default"
              )}
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => handleNavigate(currentIndex + 1)}
              disabled={currentIndex === messages.length - 1}
              className={cn(
                "absolute right-4 top-1/2 -translate-y-1/2 bg-white/10 text-white rounded-full p-2 hover:bg-white/20 transition-colors z-10",
                currentIndex === messages.length - 1 && "opacity-30 cursor-default"
              )}
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        )}

        <div className="relative flex flex-col items-center max-w-[85vw] max-h-[85vh]">
          <div className="relative w-[640px] max-w-full h-[65vh] max-h-[600px] flex items-center justify-center rounded-t-lg overflow-hidden bg-transparent">
            {!imageLoaded && mediaType !== "video" && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-white/60" />
              </div>
            )}
            {mediaType === "video" ? (
              <video
                src={mediaUrl}
                controls
                autoPlay
                playsInline
                className="max-w-full max-h-full"
              />
            ) : mediaType === "image" ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={mediaUrl}
                alt=""
                onLoad={() => setImageLoaded(true)}
                className={cn(
                  "max-w-full max-h-full object-contain transition-opacity duration-200",
                  imageLoaded ? "opacity-100" : "opacity-0"
                )}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Caption */}
      {caption && (
        <div className="flex-shrink-0 bg-transparent px-4 py-3 z-10">
          <p className="text-base font-medium text-white text-center whitespace-pre-wrap [text-shadow:0_2px_4px_rgba(0,0,0,1)]">
            {caption}
          </p>
        </div>
      )}

      {/* Footer / Media Selector */}
      {messages.length > 1 && (
        <div className="flex-shrink-0 h-24 bg-transparent">
          <MediaSelector
            messages={messages}
            currentIndex={currentIndex}
            onSelect={handleNavigate}
          />
        </div>
      )}
    </div>
  );
}
