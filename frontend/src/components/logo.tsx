import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface LogoProps {
  url?: string;
  showText?: boolean;
  imgClass?: string;
  iconClass?: string;
  textClass?: string;
  className?: string;
}

export default function Logo({
  url = "/",
  showText = true,
  imgClass,
  iconClass,
  textClass,
  className,
}: LogoProps) {
  return (
    <Link href={url} className={cn("flex items-center gap-2", className)}>
      <div className={cn("bg-primary/10 p-2 rounded-full", imgClass)}>
        <MessageCircle className={cn("size-6 text-primary", iconClass)} />
      </div>
      {showText && (
        <span className={cn("font-semibold text-lg", textClass)}>
          ChatApp
        </span>
      )}
    </Link>
  );
}
