"use client";

import { Search, SquarePen } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useUIStore } from "@/stores/ui-store";
import { AsideBarPopover } from "./aside-bar-popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const ChatListHeader = ({ searchQuery, onSearch }: { searchQuery: string; onSearch: (val: string) => void }) => {
  const { activeChatListPanel, setActiveChatListPanel } = useUIStore();

  return (
    <div className="px-3 py-3 border-b border-border">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-semibold">Chat</h1>
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-accent transition-colors"
                  onClick={() => setActiveChatListPanel(activeChatListPanel === "newChat" ? "chatList" : "newChat")}
                  aria-label="New chat"
                >
                  <SquarePen className="w-5 h-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>New chat</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <AsideBarPopover />
        </div>
      </div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search..."
          className="pl-9 bg-background text-sm"
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
    </div>
  );
};

export default ChatListHeader;
