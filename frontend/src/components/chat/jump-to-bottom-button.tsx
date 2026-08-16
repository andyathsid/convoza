"use client";

import { ArrowDown } from "lucide-react";

interface Props {
  unseenMessageCount: number;
  onClick: () => void;
}

export default function JumpToBottomButton({ unseenMessageCount, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="absolute bottom-4 right-4 z-50 flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors"
    >
      <ArrowDown className="w-5 h-5" />
      {unseenMessageCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full bg-red-500 text-white">
          {unseenMessageCount > 99 ? "99+" : unseenMessageCount}
        </span>
      )}
    </button>
  );
}
