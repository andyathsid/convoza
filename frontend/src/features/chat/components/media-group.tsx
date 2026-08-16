"use client";

import { memo } from "react";
import MediaPreview from "./media-preview";
import { Film } from "lucide-react";
import type { FirestoreMessage } from "@/features/chat/types/chat";

interface MediaGroupProps {
  messages: FirestoreMessage[];
  onOpenLightbox: (messages: FirestoreMessage[], index: number) => void;
}

const MAX_GROUP = 30;
const MAX_VISIBLE = 4;

function getAspect(msg: FirestoreMessage): "landscape" | "portrait" {
  if (msg.mediaWidth && msg.mediaHeight && msg.mediaHeight > msg.mediaWidth * 1.1) return "portrait";
  return "landscape";
}

const MediaGroup = memo(({ messages, onOpenLightbox }: MediaGroupProps) => {
  const count = Math.min(messages.length, MAX_GROUP);
  const displayMessages = messages.slice(0, Math.min(count, MAX_VISIBLE));
  const overflow = count - MAX_VISIBLE;

  const firstAspect = getAspect(messages[0]);

  // ── TUNING ──
  const SINGLE_PORTRAIT_W = 280;
  const SINGLE_LANDSCAPE_W = 340;
  const GRID_W = 340;
  // ── TUNING ──

  const getGridStyle = (): React.CSSProperties => {
    if (count === 1) {
      return {
        display: "block",
        width: firstAspect === "portrait" ? SINGLE_PORTRAIT_W : SINGLE_LANDSCAPE_W,
        aspectRatio: firstAspect === "portrait" ? "3/4" : "4/3",
      };
    }

    if (count === 2) {
      if (firstAspect === "portrait") {
        return {
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 2,
          width: GRID_W,
          aspectRatio: "4/3",
        };
      }
      return {
        display: "grid",
        gridTemplateRows: "1fr 1fr",
        gap: 2,
        width: GRID_W,
        aspectRatio: "4/3",
      };
    }

    if (count === 3) {
      return {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 2,
        width: GRID_W,
        aspectRatio: "4/3",
      };
    }

    // 4+: 2x2 grid
    return {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gridTemplateRows: "1fr 1fr",
      gap: 2,
      width: GRID_W,
      aspectRatio: "1/1",
    };
  };

  const getCellStyle = (index: number): React.CSSProperties => {
    if (count === 3 && index === 0) {
      return { gridRow: "span 2" };
    }
    return {};
  };

  const renderCell = (msg: FirestoreMessage, displayIndex: number) => {
    const msgId = msg.id || msg.pendingId || "";
    const src = msg.thumbnailUrl || msg.mediaUrl || "";
    const isVideo = msg.mediaType === "video";

    return (
      <button
        key={msgId}
        type="button"
        onClick={() => onOpenLightbox(messages, displayIndex)}
        className="relative overflow-hidden bg-muted hover:opacity-90 transition-opacity rounded-sm"
        style={getCellStyle(displayIndex)}
      >
        {isVideo ? (
          <div className="relative w-full h-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-black/50 rounded-full p-1.5">
                <Film className="h-4 w-4 text-white" />
              </div>
            </div>
          </div>
        ) : (
          <MediaPreview src={src} />
        )}

        {/* +N overlay on last visible cell */}
        {displayIndex === MAX_VISIBLE - 1 && overflow > 0 && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-white text-lg font-semibold">+{overflow}</span>
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="relative">
      <div
        className="rounded-lg overflow-hidden"
        style={getGridStyle()}
      >
        {displayMessages.map((msg, idx) => renderCell(msg, idx))}
      </div>
    </div>
  );
});

MediaGroup.displayName = "MediaGroup";

export default MediaGroup;
