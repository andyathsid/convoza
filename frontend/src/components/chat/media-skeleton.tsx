"use client";

import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

interface MediaSkeletonProps {
  variant?: "landscape" | "portrait";
  isLoading?: boolean;
  className?: string;
}

const MediaSkeleton = ({ variant = "landscape", isLoading = false, className }: MediaSkeletonProps) => {
  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden bg-muted animate-pulse max-w-full",
        // ── TUNING: aspect ratio & width per orientation ──
        variant === "landscape" ? "w-[220px] aspect-[4/3]" : "w-[165px] aspect-[3/4]",
        // ── END TUNING ──
        className
      )}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner className="w-5 h-5" />
        </div>
      )}
    </div>
  );
};

export default MediaSkeleton;
