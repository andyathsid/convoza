"use client";

import { useState, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import MediaSkeleton from "./media-skeleton";

interface MediaPreviewProps {
  /** Thumbnail or preview URL to display in the bubble */
  src: string;
  alt?: string;
  className?: string;
  onClick?: () => void;
  /** Optional overlay (e.g. UploadProgressOverlay) rendered on top */
  overlay?: ReactNode;
  /** Called when the image finishes loading, receives the img element */
  onMediaLoad?: (img: HTMLImageElement) => void;
  /** Aspect ratio for the loading skeleton, detected before image loads */
  aspect?: "landscape" | "portrait";
}

const MediaPreview = ({ src, alt = "", className, onClick, overlay, onMediaLoad, aspect = "landscape" }: MediaPreviewProps) => {
  const [loaded, setLoaded] = useState(false);

  const isBlob = src.startsWith("blob:");

  const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    setLoaded(true);
    onMediaLoad?.(e.currentTarget);
  }, [onMediaLoad]);

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden max-w-full h-full w-full",
        className
      )}
    >
      {/* Skeleton: hidden once loaded, or skipped for blob URLs */}
      {!loaded && !isBlob && (
        <div className="absolute inset-0 z-10">
          <MediaSkeleton variant={aspect} isLoading className="max-w-none w-full h-full" />
        </div>
      )}

      {/* Image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onLoad={handleLoad}
        onClick={onClick}
        className={cn(
          "absolute inset-0 w-full h-full object-cover",
          onClick && "cursor-pointer",
          !loaded && !isBlob && "opacity-0"
        )}
      />

      {/* Overlay slot (upload progress, etc.) */}
      {overlay}
    </div>
  );
};

export default MediaPreview;
