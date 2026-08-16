"use client";

import { memo, useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useChatStore } from "@/features/chat/stores/chat-store";
import { ContactSearchUnavailableError, useUserDirectory } from "@/features/chat/stores/user-directory-store";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ArrowLeft, PenBox, Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import AvatarWithBadge from "@/components/avatar-with-badge";
import { Checkbox } from "@/components/ui/checkbox";
import type { User } from "@/types/user";

export const NewChatPopover = memo(() => {
  const router = useRouter();
	const { createChat } = useChatStore();
	const searchDirectory = useUserDirectory((state) => state.search);

  const [isOpen, setIsOpen] = useState(false);
  const [isGroupMode, setIsGroupMode] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [loadingUserId, setLoadingUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
	try {
		setSearchResults(await searchDirectory(query, ""));
	} catch (error) {
		if (error instanceof ContactSearchUnavailableError) console.error(error.message);
		setSearchResults([]);
	}
    setIsSearching(false);
	}, [searchDirectory]);

  // Debounced search for both modes
  useEffect(() => {
    if (!isOpen) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(searchQuery), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, isOpen, doSearch]);

  const toggleUserSelection = (id: string) => {
    setSelectedUsers((prev) =>
      prev.includes(id) ? prev.filter((uid) => uid !== id) : [...prev, id]
    );
  };

  const resetState = () => {
    setIsGroupMode(false);
    setGroupName("");
    setSelectedUsers([]);
    setSearchQuery("");
    setSearchResults([]);
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) resetState();
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedUsers.length === 0) return;
    const chat = await createChat({
      isGroup: true,
      participants: selectedUsers,
      groupName,
    });
    setIsOpen(false);
    resetState();
    if (chat) router.push(`/chat/${chat.id}`);
  };

  const handleCreateChat = async (userId: string) => {
    setLoadingUserId(userId);
    try {
      const chat = await createChat({ participantId: userId });
      setIsOpen(false);
      resetState();
      if (chat) router.push(`/chat/${chat.id}`);
    } finally {
      setLoadingUserId(null);
    }
  };

  const renderUserList = (users: User[], showCheckboxes: boolean) => {
    if (isSearching) {
      return <div className="flex justify-center py-4"><Spinner className="w-6 h-6" /></div>;
    }
    if (users.length === 0) {
      return <div className="text-center text-muted-foreground py-4 text-sm">No users found</div>;
    }
    return users.map((u) =>
      showCheckboxes ? (
        <label key={u.id} className="w-full flex items-center gap-2 p-2 rounded-sm hover:bg-accent transition-colors text-left cursor-pointer">
          <AvatarWithBadge name={u.username} src={u.avatar} />
          <div className="flex-1 min-w-0">
            <h5 className="text-[13.5px] font-medium truncate">{u.username}</h5>
          </div>
          <Checkbox
            checked={selectedUsers.includes(u.id)}
            onCheckedChange={() => toggleUserSelection(u.id)}
          />
        </label>
      ) : (
        <button
          key={u.id}
          className="relative w-full flex items-center gap-2 p-2 rounded-sm hover:bg-accent transition-colors text-left disabled:opacity-50"
          disabled={loadingUserId !== null}
          onClick={() => handleCreateChat(u.id)}
        >
          <AvatarWithBadge name={u.username} src={u.avatar} />
          <div className="flex-1 min-w-0">
            <h5 className="text-[13.5px] font-medium truncate">{u.username}</h5>
          </div>
          {loadingUserId === u.id && <Spinner className="absolute right-2 w-4 h-4" />}
        </button>
      )
    );
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent transition-colors cursor-pointer">
        <PenBox className="!h-5 !w-5 !stroke-1" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 z-[999] p-0 rounded-xl h-[400px] max-h-[80vh] flex flex-col overflow-hidden">
        <div className="border-b p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {isGroupMode && (
              <Button variant="ghost" size="icon" onClick={() => setIsGroupMode(false)}>
                <ArrowLeft size={16} />
              </Button>
            )}
            <h3 className="text-lg font-semibold">
              {isGroupMode ? "New Group" : "New Chat"}
            </h3>
          </div>
          {isGroupMode && (
            <div className="relative">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Enter group name"
                className="pl-9"
              />
            </div>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={isGroupMode ? "Search members" : "Search name"}
              className="pl-9"
            />
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0 px-1 py-1">
          {!isGroupMode && !searchQuery.trim() ? (
            <div className="flex items-center justify-center text-sm text-muted-foreground py-8">
              Type to search
            </div>
          ) : isGroupMode && !searchQuery.trim() ? (
            <div className="flex items-center justify-center text-sm text-muted-foreground py-8">
              Search users to add
            </div>
          ) : !isGroupMode ? (
            <>
              <button
                onClick={() => setIsGroupMode(true)}
                className="w-full flex items-center gap-2 p-2 rounded-sm hover:bg-accent transition-colors text-left"
              >
                <div className="bg-primary/10 p-2 rounded-full">
                  <Users className="size-4 text-primary" />
                </div>
                <span>New Group</span>
              </button>
              {renderUserList(searchResults, false)}
            </>
          ) : (
            renderUserList(searchResults, true)
          )}
        </ScrollArea>

        {isGroupMode && (
          <div className="border-t p-3">
            <Button
              onClick={handleCreateGroup}
              className="w-full"
              disabled={!groupName.trim() || selectedUsers.length === 0}
            >
              Create Group
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
});

NewChatPopover.displayName = "NewChatPopover";
