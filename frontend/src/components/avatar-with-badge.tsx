import { cn } from "@/lib/utils";

interface AvatarWithBadgeProps {
  name: string;
  src?: string;
  isOnline?: boolean;
  isGroup?: boolean;
  size?: string;
  className?: string;
}

export default function AvatarWithBadge({
  name,
  src,
  isOnline,
  isGroup = false,
  size = "w-9 h-9",
  className,
}: AvatarWithBadgeProps) {
  return (
    <div className="relative shrink-0">
      <div
        className={cn(
          "rounded-full bg-secondary flex items-center justify-center overflow-hidden",
          size
        )}
      >
        {src ? (
          <img src={src} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span
            className={cn(
              "text-secondary-foreground font-semibold",
              className
            )}
          >
            {name?.charAt(0)?.toUpperCase()}
          </span>
        )}
      </div>
      {isOnline && !isGroup && (
        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 bg-green-500" />
      )}
    </div>
  );
}
